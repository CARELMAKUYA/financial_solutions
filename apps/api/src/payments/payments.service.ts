import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { AuditService, Tx } from '../common/audit.service';
import { DateOnly, fromDbDate, todaySast, toDbDate } from '../common/dates';
import { AuthUser } from '../common/decorators';
import { formatRand, lockLoan, METHOD_LABEL, nextNumber } from '../common/util';
import { previewPayment } from '../loans/engine';
import { LedgerService } from '../loans/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';

const TX = { timeout: 20_000, maxWait: 10_000 };

export interface PaymentInput {
  amountCents: number;
  paymentDate: DateOnly;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private validateDate(paymentDate: DateOnly, disbursedOn: Date) {
    if (paymentDate > todaySast()) throw new BadRequestException('The payment date cannot be in the future');
    if (paymentDate < fromDbDate(disbursedOn)) throw new BadRequestException('The payment date is before the loan was disbursed');
  }

  private async possibleDuplicates(tx: Tx, loanId: string, amountCents: number, paymentDate: DateOnly, excludeId?: string) {
    return tx.payment.findMany({
      where: {
        loanId,
        amountCents,
        paymentDate: toDbDate(paymentDate),
        status: { in: ['CONFIRMED', 'PENDING_VERIFICATION'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, transactionNumber: true, amountCents: true, paymentDate: true, method: true, reference: true, recordedAt: true, status: true },
    });
  }

  /** What the confirmation screen shows. Uses the same engine that saves the payment. */
  async preview(loanId: string, input: Pick<PaymentInput, 'amountCents' | 'paymentDate' | 'method'> & { requireVerification?: boolean }) {
    const tx = this.prisma as unknown as Tx;
    const { loan, input: engineInput } = await this.ledger.engineInput(tx, loanId);
    if (loan.status === 'CANCELLED') throw new BadRequestException('This loan was cancelled');
    this.validateDate(input.paymentDate, loan.disbursedOn);
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: loan.clientId } });
    const { current, after, allocation } = previewPayment(engineInput, { date: input.paymentDate, amountCents: input.amountCents });
    const settings = await this.settings.get();
    const needsVerification = Boolean(input.requireVerification) || settings.verifyMethods.includes(input.method);
    const duplicates = await this.possibleDuplicates(tx, loanId, input.amountCents, input.paymentDate);
    const warnings: string[] = [];
    if (input.paymentDate < todaySast()) warnings.push(`This payment is backdated to ${input.paymentDate}. Balances will be recalculated from that date.`);
    if (allocation.overpaymentCents > 0)
      warnings.push(`This is ${formatRand(allocation.overpaymentCents)} more than the amount needed to settle the loan. The excess will be held as an overpayment and flagged for review.`);
    if (loan.status === 'SETTLED') warnings.push('This loan is already fully paid. The whole amount will be held as an overpayment.');
    if (duplicates.length) warnings.push('A payment with the same amount and date has already been recorded on this loan. Check that this is not a duplicate.');
    if (needsVerification) warnings.push('This payment will be saved as "awaiting verification" and will only reduce the balance once it is verified.');
    return {
      clientName: `${client.firstName} ${client.lastName}`,
      loanReference: loan.reference,
      currentBalanceCents: current.totalCents,
      scheduledInstalmentCents: current.nextDue?.amountCents ?? loan.instalmentCents,
      arrearsCents: current.arrearsCents,
      allocation: {
        interestCents: allocation.interestCents,
        feesCents: allocation.feesCents,
        principalCents: allocation.principalCents,
        overpaymentCents: allocation.overpaymentCents,
        instalments: allocation.instalments.map((i) => ({ seq: i.seq % 1000, amountCents: i.amountCents })),
      },
      balanceAfterCents: after.totalCents,
      arrearsAfterCents: after.arrearsCents,
      settles: after.settledOn !== null && current.settledOn === null,
      needsVerification,
      duplicates,
      warnings,
    };
  }

  async record(loanId: string, dto: PaymentInput & { idempotencyKey: string; confirmDuplicate?: boolean; requireVerification?: boolean }, user: AuthUser) {
    // A retry of the same submission returns the payment that was already saved.
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      if (existing.loanId !== loanId) throw new ConflictException('This submission key was already used for another loan');
      return { payment: existing, alreadyRecorded: true };
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await lockLoan(tx, loanId))) throw new NotFoundException('Loan not found');
        // Checked again under the lock, in case an identical request was in flight.
        const again = await tx.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (again) return { payment: again, alreadyRecorded: true };

        const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId } });
        if (loan.status === 'CANCELLED') throw new BadRequestException('This loan was cancelled');
        this.validateDate(dto.paymentDate, loan.disbursedOn);

        const duplicates = await this.possibleDuplicates(tx, loanId, dto.amountCents, dto.paymentDate);
        if (duplicates.length && !dto.confirmDuplicate) {
          throw new ConflictException({
            message: `A payment of ${formatRand(dto.amountCents)} on this date is already recorded (${duplicates.map((d) => d.transactionNumber).join(', ')}). Confirm that this is a separate payment to record it.`,
            code: 'POSSIBLE_DUPLICATE',
            duplicates,
          });
        }

        const settings = await this.settings.get(tx);
        const needsVerification = Boolean(dto.requireVerification) || settings.verifyMethods.includes(dto.method);
        const { state: before } = await this.ledger.state(tx, loanId);
        const year = todaySast().slice(0, 4);
        const payment = await tx.payment.create({
          data: {
            transactionNumber: await nextNumber(tx, `payment-${year}`, `TQP-${year}-`, 6),
            loanId,
            clientId: loan.clientId,
            amountCents: dto.amountCents,
            paymentDate: toDbDate(dto.paymentDate),
            recordedById: user.id,
            method: dto.method,
            reference: dto.reference?.trim() || null,
            notes: dto.notes?.trim() || null,
            status: needsVerification ? 'PENDING_VERIFICATION' : 'CONFIRMED',
            idempotencyKey: dto.idempotencyKey,
            scheduledInstalmentCents: before.nextDue?.amountCents ?? loan.instalmentCents,
            balanceBeforeCents: before.totalCents,
          },
        });
        if (needsVerification) {
          await tx.paymentVerification.create({ data: { paymentId: payment.id, action: 'FLAGGED', notes: dto.requireVerification ? 'Flagged when recorded' : `${METHOD_LABEL[dto.method]} payments require verification`, userId: user.id } });
          await tx.notification.createMany({
            data: [
              {
                type: 'VERIFICATION_NEEDED',
                title: `Verify ${payment.transactionNumber} (${formatRand(dto.amountCents)})`,
                body: `${METHOD_LABEL[dto.method]} payment on ${loan.reference} is awaiting verification and does not yet reduce the balance.`,
                loanId,
                dedupeKey: `VERIFY:${payment.id}`,
              },
            ],
            skipDuplicates: true,
          });
        }
        const { state } = await this.ledger.recompute(tx, loanId, user.id);
        const allocation = state.allocations.find((a) => a.paymentId === payment.id) ?? null;
        await this.audit.log(
          user.id,
          'PAYMENT_RECORDED',
          'Payment',
          payment.id,
          {
            loan: loan.reference,
            transactionNumber: payment.transactionNumber,
            amountCents: dto.amountCents,
            paymentDate: dto.paymentDate,
            method: dto.method,
            reference: dto.reference ?? null,
            status: payment.status,
            confirmedDuplicate: duplicates.length > 0,
            balanceBeforeCents: before.totalCents,
            balanceAfterCents: state.totalCents,
            allocation: allocation
              ? { interest: allocation.interestCents, fees: allocation.feesCents, principal: allocation.principalCents, overpayment: allocation.overpaymentCents }
              : null,
          },
          tx,
        );
        return { payment, alreadyRecorded: false, balanceAfterCents: state.totalCents, settled: state.settledOn !== null };
      }, TX);
    } catch (err) {
      // Two identical submissions raced past the first check: the unique key stops the second.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const p = await this.prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (p) return { payment: p, alreadyRecorded: true };
      }
      throw err;
    }
  }

  private async lockedPayment(tx: Tx, paymentId: string) {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('Payment not found');
    await lockLoan(tx, p.loanId);
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  async verify(paymentId: string, approve: boolean, notes: string | undefined, user: AuthUser) {
    if (!approve && (!notes || notes.trim().length < 5)) throw new BadRequestException('Give a reason for rejecting the payment');
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockedPayment(tx, paymentId);
      if (p.status !== 'PENDING_VERIFICATION') throw new ConflictException('This payment is not awaiting verification');
      await tx.payment.update({ where: { id: p.id }, data: { status: approve ? 'CONFIRMED' : 'REJECTED' } });
      await tx.paymentVerification.create({ data: { paymentId: p.id, action: approve ? 'VERIFIED' : 'REJECTED', notes, userId: user.id } });
      await tx.notification.updateMany({ where: { dedupeKey: `VERIFY:${p.id}`, readAt: null }, data: { readAt: new Date(), readById: user.id } });
      const { state } = await this.ledger.recompute(tx, p.loanId, user.id);
      await this.audit.log(user.id, approve ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', 'Payment', p.id, { transactionNumber: p.transactionNumber, amountCents: p.amountCents, notes, balanceAfterCents: state.totalCents }, tx);
      return { ok: true };
    }, TX);
  }

  async reverse(paymentId: string, reason: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockedPayment(tx, paymentId);
      if (p.status !== 'CONFIRMED') throw new ConflictException(p.status === 'PENDING_VERIFICATION' ? 'Reject an unverified payment instead of reversing it' : 'This payment is not confirmed');
      const { state: before } = await this.ledger.state(tx, p.loanId);
      await tx.payment.update({ where: { id: p.id }, data: { status: 'REVERSED' } });
      await tx.paymentAdjustment.create({ data: { paymentId: p.id, kind: 'REVERSAL', reason, authorisedById: user.id } });
      const { state } = await this.ledger.recompute(tx, p.loanId, user.id);
      await this.audit.log(
        user.id,
        'PAYMENT_REVERSED',
        'Payment',
        p.id,
        { transactionNumber: p.transactionNumber, amountCents: p.amountCents, paymentDate: fromDbDate(p.paymentDate), reason, balanceBeforeCents: before.totalCents, balanceAfterCents: state.totalCents },
        tx,
      );
      return { ok: true, balanceAfterCents: state.totalCents };
    }, TX);
  }

  /** Reverses the original and records a linked replacement with the corrected details, atomically. */
  async correct(paymentId: string, dto: PaymentInput & { reason: string }, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockedPayment(tx, paymentId);
      if (p.status !== 'CONFIRMED') throw new ConflictException('Only confirmed payments can be corrected');
      const loan = await tx.loan.findUniqueOrThrow({ where: { id: p.loanId } });
      this.validateDate(dto.paymentDate, loan.disbursedOn);
      const { state: before } = await this.ledger.state(tx, p.loanId);
      await tx.payment.update({ where: { id: p.id }, data: { status: 'REVERSED' } });
      const year = todaySast().slice(0, 4);
      const replacement = await tx.payment.create({
        data: {
          transactionNumber: await nextNumber(tx, `payment-${year}`, `TQP-${year}-`, 6),
          loanId: p.loanId,
          clientId: p.clientId,
          amountCents: dto.amountCents,
          paymentDate: toDbDate(dto.paymentDate),
          recordedById: user.id,
          method: dto.method,
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || `Correction of ${p.transactionNumber}`,
          status: 'CONFIRMED',
          idempotencyKey: `correction:${p.id}`,
          scheduledInstalmentCents: p.scheduledInstalmentCents,
          balanceBeforeCents: before.totalCents,
          replacesPaymentId: p.id,
        },
      });
      await tx.paymentAdjustment.create({ data: { paymentId: p.id, kind: 'CORRECTION', reason: dto.reason, replacementPaymentId: replacement.id, authorisedById: user.id } });
      const { state } = await this.ledger.recompute(tx, p.loanId, user.id);
      await this.audit.log(
        user.id,
        'PAYMENT_CORRECTED',
        'Payment',
        p.id,
        {
          reason: dto.reason,
          original: { transactionNumber: p.transactionNumber, amountCents: p.amountCents, paymentDate: fromDbDate(p.paymentDate), method: p.method, reference: p.reference },
          replacement: { id: replacement.id, transactionNumber: replacement.transactionNumber, amountCents: dto.amountCents, paymentDate: dto.paymentDate, method: dto.method, reference: dto.reference ?? null },
          balanceBeforeCents: before.totalCents,
          balanceAfterCents: state.totalCents,
        },
        tx,
      );
      return { replacement };
    }, TX);
  }

  /** Overpayment review: record the outcome and optionally refund the credit (as an authorised adjustment). */
  async resolveOverpayment(paymentId: string, dto: { resolution: string; refundCents?: number; refundDate?: DateOnly }, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockedPayment(tx, paymentId);
      if (!p.overpaymentFlag) throw new BadRequestException('This payment is not flagged as an overpayment');
      if (p.overpaymentResolvedAt) throw new ConflictException('This overpayment has already been resolved');
      if (dto.refundCents) {
        const date = dto.refundDate ?? todaySast();
        if (date > todaySast()) throw new BadRequestException('The refund date cannot be in the future');
        const loan = await tx.loan.findUniqueOrThrow({ where: { id: p.loanId } });
        if (dto.refundCents > loan.overpaymentCents) throw new BadRequestException(`The refund can't be more than the overpayment held (${formatRand(loan.overpaymentCents)})`);
        await tx.loanAdjustment.create({
          data: { loanId: p.loanId, kind: 'OVERPAYMENT_REFUND', amountCents: dto.refundCents, effectiveDate: toDbDate(date), reason: `Refund of overpayment on ${p.transactionNumber}: ${dto.resolution}`, authorisedById: user.id },
        });
      }
      await tx.payment.update({ where: { id: p.id }, data: { overpaymentResolvedAt: new Date(), overpaymentResolution: dto.resolution } });
      await tx.notification.updateMany({ where: { dedupeKey: `OVERPAYMENT:${p.id}`, readAt: null }, data: { readAt: new Date(), readById: user.id } });
      const { state } = await this.ledger.recompute(tx, p.loanId, user.id);
      await this.audit.log(user.id, 'OVERPAYMENT_RESOLVED', 'Payment', p.id, { resolution: dto.resolution, refundCents: dto.refundCents ?? 0, overpaymentLeftCents: state.overpaymentCents }, tx);
      return { ok: true };
    }, TX);
  }

  async list(params: { from?: string; to?: string; method?: PaymentMethod; status?: string; search?: string; overpayments?: boolean }) {
    const where: Prisma.PaymentWhereInput = {};
    if (params.from || params.to) where.paymentDate = { ...(params.from ? { gte: toDbDate(params.from) } : {}), ...(params.to ? { lte: toDbDate(params.to) } : {}) };
    if (params.method) where.method = params.method;
    if (params.status) where.status = params.status as Prisma.EnumPaymentStatusFilter['equals'];
    if (params.overpayments) {
      where.overpaymentFlag = true;
      where.overpaymentResolvedAt = null;
    }
    if (params.search) {
      const s = params.search.trim();
      where.OR = [
        { transactionNumber: { contains: s, mode: 'insensitive' } },
        { reference: { contains: s, mode: 'insensitive' } },
        { loan: { reference: { contains: s, mode: 'insensitive' } } },
        { loan: { client: { lastName: { contains: s, mode: 'insensitive' } } } },
        { loan: { client: { firstName: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ paymentDate: 'desc' }, { recordedAt: 'desc' }],
      take: 1000,
      include: {
        loan: { select: { id: true, reference: true, client: { select: { id: true, firstName: true, lastName: true } } } },
        allocations: { where: { supersededAt: null } },
      },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, name: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, recordedByName: names[r.recordedById] ?? '—' }));
  }
}
