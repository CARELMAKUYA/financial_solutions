import { Injectable, NotFoundException } from '@nestjs/common';
import { AllocationComponent, InstalmentStatus, Loan, LoanStatus, Prisma } from '@prisma/client';
import { Tx } from '../common/audit.service';
import { DateOnly, fromDbDate, todaySast, toDbDate } from '../common/dates';
import { formatRand } from '../common/util';
import { SettingsService } from '../settings/settings.module';
import { Component, computeLedger, EngineInput, LedgerState } from './engine';

/**
 * Bridges the database and the pure ledger engine. `recompute` is the only code that writes a
 * loan's derived balances, instalment statuses and payment allocations, and it always runs inside
 * the caller's transaction, so a payment can never be saved without its balance updates.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly settings: SettingsService) {}

  /** Builds the engine input from what's in the database (confirmed payments, live adjustments). */
  async engineInput(tx: Tx, loanId: string, asOf: DateOnly = todaySast()): Promise<{ loan: Loan; input: EngineInput }> {
    const loan = await tx.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('Loan not found');
    const [instalments, payments, adjustments, settings] = await Promise.all([
      tx.instalment.findMany({ where: { loanId }, orderBy: [{ dueDate: 'asc' }, { version: 'asc' }, { seq: 'asc' }] }),
      tx.payment.findMany({ where: { loanId, status: 'CONFIRMED' }, orderBy: [{ paymentDate: 'asc' }, { recordedAt: 'asc' }] }),
      tx.loanAdjustment.findMany({ where: { loanId, reversedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.settings.get(tx),
    ]);
    return {
      loan,
      input: {
        principalDebtCents: loan.principalDebtCents,
        annualRateBps: loan.annualRateBps,
        disbursedOn: fromDbDate(loan.disbursedOn),
        instalments: instalments.map((i) => ({
          id: i.id,
          // Unique ordering across schedule versions: version*1000 + seq.
          seq: i.version * 1000 + i.seq,
          dueDate: fromDbDate(i.dueDate),
          amountCents: i.supersededOn ? (i.supersededPaidCents ?? 0) : i.amountCents,
          // The service fee is charged on each due date. (An arrangement's instalment `feeCents` also
          // carries a share of charges that were already owed, which must not be charged again.)
          feeCents: loan.serviceFeeCents,
          superseded: Boolean(i.supersededOn),
          supersededFrom: i.supersededOn ? fromDbDate(i.supersededOn) : undefined,
        })),
        payments: payments.map((p) => ({
          id: p.id,
          date: fromDbDate(p.paymentDate),
          amountCents: p.amountCents,
          order: p.recordedAt.toISOString(),
        })),
        adjustments: adjustments.map((a) => ({
          id: a.id,
          date: fromDbDate(a.effectiveDate),
          kind: a.kind,
          amountCents: a.amountCents,
          order: a.createdAt.toISOString(),
        })),
        allocationOrder: settings.allocationOrder as Component[],
        inDuplum: settings.inDuplum,
        asOf,
      },
    };
  }

  /** Current ledger without writing anything. */
  async state(tx: Tx, loanId: string, asOf?: DateOnly): Promise<{ loan: Loan; input: EngineInput; state: LedgerState }> {
    const { loan, input } = await this.engineInput(tx, loanId, asOf);
    return { loan, input, state: computeLedger(input) };
  }

  /**
   * Recomputes and persists a loan's derived state. Call with the loan row locked (lockLoan).
   * Returns the new state and whether the loan just became settled.
   */
  async recompute(tx: Tx, loanId: string, userId: string | null, asOf: DateOnly = todaySast()) {
    const { loan, state } = await this.state(tx, loanId, asOf);
    if (loan.status === 'CANCELLED') return { loan, state, justSettled: false };

    const pending = await tx.payment.aggregate({ where: { loanId, status: 'PENDING_VERIFICATION' }, _sum: { amountCents: true } });

    // ---- Loan snapshot and status
    let status: LoanStatus = loan.status;
    let justSettled = false;
    if (state.settledOn && loan.status === 'ACTIVE') {
      status = 'SETTLED';
      justSettled = true;
    } else if (!state.settledOn && loan.status === 'SETTLED') {
      status = 'ACTIVE'; // A reversal re-opened the loan.
    }
    const updated = await tx.loan.update({
      where: { id: loanId },
      data: {
        status,
        principalOutstandingCents: state.principalCents,
        interestOutstandingCents: state.interestCents,
        feesOutstandingCents: state.feesCents,
        totalOutstandingCents: state.totalCents,
        arrearsCents: state.arrearsCents,
        oldestArrearsDate: state.oldestArrearsDate ? toDbDate(state.oldestArrearsDate) : null,
        overpaymentCents: state.overpaymentCents,
        totalPaidCents: state.totalPaidCents,
        lastPaymentDate: state.lastPaymentDate ? toDbDate(state.lastPaymentDate) : null,
        nextDueDate: state.nextDue ? toDbDate(state.nextDue.dueDate) : null,
        nextDueCents: state.nextDue?.amountCents ?? 0,
        pendingVerificationCents: pending._sum.amountCents ?? 0,
        inDuplumCapped: state.inDuplumCapped,
        settledOn: state.settledOn ? toDbDate(state.settledOn) : null,
        recomputedAt: new Date(),
      },
    });

    // ---- Instalments (only rows that changed)
    const current = await tx.instalment.findMany({ where: { loanId } });
    const byId = new Map(current.map((i) => [i.id, i]));
    for (const s of state.instalments) {
      const row = byId.get(s.id)!;
      const next = {
        paidCents: s.paidCents,
        remainingCents: s.remainingCents,
        amountDueCents: s.amountDueCents,
        status: s.status as InstalmentStatus,
        fullyPaidOn: s.fullyPaidOn ? toDbDate(s.fullyPaidOn) : null,
        lastPaymentDate: s.lastPaymentDate ? toDbDate(s.lastPaymentDate) : null,
      };
      const same =
        row.paidCents === next.paidCents &&
        row.remainingCents === next.remainingCents &&
        row.amountDueCents === next.amountDueCents &&
        row.status === next.status &&
        row.fullyPaidOn?.getTime() === next.fullyPaidOn?.getTime() &&
        row.lastPaymentDate?.getTime() === next.lastPaymentDate?.getTime();
      if (!same) {
        await tx.instalment.update({
          where: { id: s.id },
          // Once paid in full, any "missed"/"promise" follow-up status no longer applies.
          data: { ...next, ...(next.status === 'PAID' ? { collectionStatus: 'NONE', promiseDate: null } : {}) },
        });
      }
    }

    // ---- Payment allocations: supersede and re-add only where the allocation changed
    const existing = await tx.paymentAllocation.findMany({ where: { loanId, supersededAt: null } });
    const existingByPayment = new Map<string, typeof existing>();
    for (const a of existing) existingByPayment.set(a.paymentId, [...(existingByPayment.get(a.paymentId) ?? []), a]);

    const wanted = new Map<string, { component: AllocationComponent; amountCents: number; balanceAfterCents: number }[]>();
    for (const a of state.allocations) {
      const rows: { component: AllocationComponent; amountCents: number; balanceAfterCents: number }[] = [];
      const add = (component: AllocationComponent, amountCents: number) => amountCents > 0 && rows.push({ component, amountCents, balanceAfterCents: a.balanceAfterCents });
      add('INTEREST', a.interestCents);
      add('FEES', a.feesCents);
      add('PRINCIPAL', a.principalCents);
      add('OVERPAYMENT', a.overpaymentCents);
      wanted.set(a.paymentId, rows);
    }
    const key = (rows: { component: string; amountCents: number; balanceAfterCents: number }[]) =>
      rows
        .map((r) => `${r.component}:${r.amountCents}:${r.balanceAfterCents}`)
        .sort()
        .join('|');
    const now = new Date();
    for (const paymentId of new Set([...existingByPayment.keys(), ...wanted.keys()])) {
      const have = existingByPayment.get(paymentId) ?? [];
      const want = wanted.get(paymentId) ?? [];
      if (key(have) === key(want)) continue;
      if (have.length) await tx.paymentAllocation.updateMany({ where: { id: { in: have.map((h) => h.id) } }, data: { supersededAt: now } });
      if (want.length) await tx.paymentAllocation.createMany({ data: want.map((w) => ({ ...w, paymentId, loanId })) });
    }

    // ---- Overpayment flags
    for (const a of state.allocations) {
      if (a.overpaymentCents > 0) {
        const p = await tx.payment.findUnique({ where: { id: a.paymentId }, select: { overpaymentFlag: true, transactionNumber: true } });
        if (p && !p.overpaymentFlag) {
          await tx.payment.update({ where: { id: a.paymentId }, data: { overpaymentFlag: true } });
          await tx.notification.createMany({
            data: [
              {
                type: 'OVERPAYMENT',
                title: `Overpayment on ${loan.reference}`,
                body: `Payment ${p.transactionNumber} exceeded the settlement amount by ${formatRand(a.overpaymentCents)}. Review and refund or resolve it.`,
                loanId,
                dedupeKey: `OVERPAYMENT:${a.paymentId}`,
              },
            ],
            skipDuplicates: true,
          });
        }
      }
    }

    if (justSettled) {
      await tx.notification.createMany({
        data: [
          {
            type: 'LOAN_SETTLED',
            title: `${loan.reference} is fully paid`,
            body: `The loan was settled on ${state.settledOn}. Reminders have stopped and the settlement letter is ready to download.`,
            loanId,
            dedupeKey: `SETTLED:${loanId}:${state.settledOn}`,
          },
        ],
        skipDuplicates: true,
      });
    }
    if (status !== loan.status) {
      await tx.auditLog.create({
        data: {
          userId,
          action: status === 'SETTLED' ? 'LOAN_SETTLED' : 'LOAN_REOPENED',
          entity: 'Loan',
          entityId: loanId,
          details: { from: loan.status, to: status, settledOn: state.settledOn } as Prisma.InputJsonValue,
        },
      });
    }
    return { loan: updated, state, justSettled };
  }
}
