import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, Tx } from '../common/audit.service';
import { DateOnly, fromDbDate, todaySast, toDbDate } from '../common/dates';
import { AuthUser } from '../common/decorators';
import { lockLoan, nextNumber } from '../common/util';
import { requiredStatementCount, requireStatements } from '../common/statements';
import { PrismaService } from '../prisma/prisma.service';
import { buildSchedule } from './engine';
import { LedgerService } from './ledger.service';
import { ArrangementDto, CreateLoanDto, FollowUpDto, LoanAdjustmentDto, QuoteDto } from './loans.dto';

const TX = { timeout: 20_000, maxWait: 10_000 };

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  quote(dto: QuoteDto) {
    if (dto.firstDueDate <= dto.disbursedOn) throw new BadRequestException('The first due date must be after the disbursement date');
    const principalDebtCents = dto.loanAmountCents + dto.initiationFeeCents;
    const schedule = buildSchedule({
      principalCents: principalDebtCents,
      monthlyRateBps: dto.monthlyRateBps,
      startDate: dto.disbursedOn,
      firstDueDate: dto.firstDueDate,
      instalments: dto.numberOfInstalments,
      frequency: dto.frequency,
      serviceFeeCents: dto.serviceFeeCents,
    });
    return {
      loanAmountCents: dto.loanAmountCents,
      initiationFeeCents: dto.initiationFeeCents,
      principalDebtCents,
      ...schedule,
      totalCostOfCreditCents: schedule.totalRepayableCents - dto.loanAmountCents,
    };
  }

  async create(dto: CreateLoanDto, user: AuthUser) {
    const today = todaySast();
    if (dto.disbursedOn > today) throw new BadRequestException('The disbursement date cannot be in the future');
    const q = this.quote(dto);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) throw new NotFoundException('Client not found');
      if (client.status !== 'ACTIVE') throw new BadRequestException('This client is archived');
      if (dto.applicationId) {
        const app = await tx.loanApplication.findUnique({ where: { id: dto.applicationId }, include: { loan: true } });
        if (!app || app.clientId !== dto.clientId) throw new BadRequestException('The application does not belong to this client');
        if (app.loan) throw new ConflictException('A loan has already been issued for this application');
        if (app.status !== 'APPROVED') throw new BadRequestException('Only an approved application can be issued as a loan');
        await tx.loanApplication.update({ where: { id: app.id }, data: { status: 'ISSUED' } });
      }
      const app = dto.applicationId ? await tx.loanApplication.findUnique({ where: { id: dto.applicationId }, select: { createdAt: true } }) : null;
      // Measured from the application date, or for a loan captured without one, its disbursement date.
      await requireStatements(tx, dto.clientId, app ? todaySast(app.createdAt) : dto.disbursedOn, await requiredStatementCount(tx), 'issuing a loan');
      const reference = await nextNumber(tx, `loan-${today.slice(0, 4)}`, `TQL-${today.slice(0, 4)}-`, 5);
      const loan = await tx.loan.create({
        data: {
          reference,
          clientId: dto.clientId,
          applicationId: dto.applicationId,
          product: dto.product,
          frequency: dto.frequency,
          loanAmountCents: dto.loanAmountCents,
          initiationFeeCents: dto.initiationFeeCents,
          principalDebtCents: q.principalDebtCents,
          monthlyRateBps: dto.monthlyRateBps,
          serviceFeeCents: dto.serviceFeeCents,
          numberOfInstalments: dto.numberOfInstalments,
          disbursedOn: toDbDate(dto.disbursedOn),
          firstDueDate: toDbDate(dto.firstDueDate),
          instalmentCents: q.instalmentCents,
          notes: dto.notes,
          createdById: user.id,
          instalments: {
            create: q.instalments.map((i) => ({
              version: 1,
              seq: i.seq,
              dueDate: toDbDate(i.dueDate),
              amountCents: i.amountCents,
              principalCents: i.principalCents,
              interestCents: i.interestCents,
              feeCents: i.feeCents,
              amountDueCents: i.amountCents,
              remainingCents: i.amountCents,
            })),
          },
        },
      });
      await lockLoan(tx, loan.id);
      await this.ledger.recompute(tx, loan.id, user.id);
      await this.audit.log(
        user.id,
        'LOAN_ISSUED',
        'Loan',
        loan.id,
        {
          reference,
          client: client.clientNumber,
          loanAmountCents: dto.loanAmountCents,
          initiationFeeCents: dto.initiationFeeCents,
          monthlyRateBps: dto.monthlyRateBps,
          serviceFeeCents: dto.serviceFeeCents,
          instalments: dto.numberOfInstalments,
          frequency: dto.frequency,
          instalmentCents: q.instalmentCents,
          disbursedOn: dto.disbursedOn,
          firstDueDate: dto.firstDueDate,
        },
        tx,
      );
      return loan;
    }, TX);
  }

  async list(params: { status?: string; search?: string; clientId?: string; arrears?: boolean }) {
    const where: Prisma.LoanWhereInput = {};
    if (params.status) where.status = params.status as Prisma.EnumLoanStatusFilter['equals'];
    if (params.clientId) where.clientId = params.clientId;
    if (params.arrears) where.arrearsCents = { gt: 0 };
    if (params.search) {
      const s = params.search.trim();
      where.OR = [
        { reference: { contains: s, mode: 'insensitive' } },
        { client: { firstName: { contains: s, mode: 'insensitive' } } },
        { client: { lastName: { contains: s, mode: 'insensitive' } } },
        { client: { idNumber: { contains: s } } },
        { client: { clientNumber: { contains: s, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.loan.findMany({
      where,
      include: { client: { select: { id: true, firstName: true, lastName: true, clientNumber: true, phone: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async detail(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        client: true,
        application: { select: { id: true, applicationNumber: true } },
        instalments: { orderBy: [{ version: 'asc' }, { seq: 'asc' }] },
        payments: {
          orderBy: [{ paymentDate: 'desc' }, { recordedAt: 'desc' }],
          include: {
            allocations: { where: { supersededAt: null } },
            adjustments: true,
            verifications: { orderBy: { createdAt: 'asc' } },
            documents: { select: { id: true, fileName: true, mimeType: true } },
          },
        },
        adjustments: { orderBy: { createdAt: 'desc' } },
        arrangements: { orderBy: { createdAt: 'desc' } },
        followUps: { orderBy: { createdAt: 'desc' }, take: 100 },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');

    const userIds = new Set<string>([loan.createdById]);
    loan.payments.forEach((p) => {
      userIds.add(p.recordedById);
      p.adjustments.forEach((a) => userIds.add(a.authorisedById));
      p.verifications.forEach((v) => userIds.add(v.userId));
    });
    loan.adjustments.forEach((a) => {
      userIds.add(a.authorisedById);
      if (a.reversedById) userIds.add(a.reversedById);
    });
    loan.arrangements.forEach((a) => userIds.add(a.authorisedById));
    loan.followUps.forEach((f) => userIds.add(f.createdById));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));

    // Live figures (settlement amount today, which instalments each payment went to).
    const { state } = await this.ledger.state(this.prisma as never, id);
    const coverage = Object.fromEntries(state.allocations.map((a) => [a.paymentId, a.instalments.map((x) => ({ seq: x.seq % 1000, amountCents: x.amountCents }))]));

    const audit = await this.prisma.auditLog.findMany({
      where: { OR: [{ entity: 'Loan', entityId: id }, { entity: 'Payment', entityId: { in: loan.payments.map((p) => p.id) } }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true } } },
    });

    return {
      ...loan,
      userNames: names,
      coverage,
      settlementQuote: {
        asOf: todaySast(),
        principalCents: state.principalCents,
        interestCents: state.interestCents,
        futureInterestCents: state.futureInterestCents,
        feesCents: state.feesCents,
        totalCents: state.totalCents,
      },
      daysInArrears: state.daysInArrears,
      audit,
    };
  }

  /**
   * Interest on the current schedule's instalments that aren't due yet. An arrangement moves it to the
   * new due dates rather than charging the monthly rate again, so rescheduling never adds interest.
   */
  private async interestNotYetDue(db: Tx, loanId: string, today: DateOnly) {
    const r = await db.instalment.aggregate({ where: { loanId, supersededOn: null, dueDate: { gt: toDbDate(today) } }, _sum: { interestCents: true } });
    return r._sum.interestCents ?? 0;
  }

  async previewArrangement(id: string, dto: ArrangementDto) {
    const today = todaySast();
    if (dto.firstDueDate <= today) throw new BadRequestException('The first new due date must be after today');
    const { loan, state } = await this.ledger.state(this.prisma as never, id);
    if (loan.status !== 'ACTIVE') throw new BadRequestException('Only active loans can be rescheduled');
    const fixedInterestCents = await this.interestNotYetDue(this.prisma as never, id, today);
    const schedule = buildSchedule({
      principalCents: state.principalCents,
      monthlyRateBps: loan.monthlyRateBps,
      startDate: today,
      firstDueDate: dto.firstDueDate,
      instalments: dto.numberOfInstalments,
      frequency: dto.frequency,
      serviceFeeCents: loan.serviceFeeCents,
      carriedChargesCents: state.interestCents - state.futureInterestCents + state.feesCents,
      fixedInterestCents,
    });
    return { balanceCents: state.totalCents, arrearsCents: state.arrearsCents, ...schedule };
  }

  async createArrangement(id: string, dto: ArrangementDto, user: AuthUser) {
    if (!dto.reason) throw new BadRequestException('Give a reason for the new arrangement');
    const today = todaySast();
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockLoan(tx, id))) throw new NotFoundException('Loan not found');
      const { state } = await this.ledger.recompute(tx, id, user.id);
      const loan = await tx.loan.findUniqueOrThrow({ where: { id } });
      if (loan.status !== 'ACTIVE') throw new BadRequestException('Only active loans can be rescheduled');
      if (dto.firstDueDate <= today) throw new BadRequestException('The first new due date must be after today');
      const fixedInterestCents = await this.interestNotYetDue(tx, id, today);
      const schedule = buildSchedule({
        principalCents: state.principalCents,
        monthlyRateBps: loan.monthlyRateBps,
        startDate: today,
        firstDueDate: dto.firstDueDate,
        instalments: dto.numberOfInstalments,
        frequency: dto.frequency,
        serviceFeeCents: loan.serviceFeeCents,
        carriedChargesCents: state.interestCents - state.futureInterestCents + state.feesCents,
      fixedInterestCents,
      });
      const newVersion = loan.scheduleVersion + 1;
      const arrangement = await tx.repaymentArrangement.create({
        data: {
          loanId: id,
          effectiveDate: toDbDate(today),
          previousVersion: loan.scheduleVersion,
          newVersion,
          frequency: dto.frequency,
          numberOfInstalments: dto.numberOfInstalments,
          firstDueDate: toDbDate(dto.firstDueDate),
          instalmentCents: schedule.instalmentCents,
          balanceAtArrangementCents: state.totalCents,
          reason: dto.reason!,
          authorisedById: user.id,
        },
      });
      // Supersede every still-open instalment; what was paid towards it stays on record.
      const open = await tx.instalment.findMany({ where: { loanId: id, supersededOn: null, status: { not: 'PAID' } } });
      for (const i of open) {
        await tx.instalment.update({ where: { id: i.id }, data: { supersededOn: toDbDate(today), supersededPaidCents: i.paidCents } });
      }
      await tx.instalment.createMany({
        data: schedule.instalments.map((i) => ({
          loanId: id,
          version: newVersion,
          seq: i.seq,
          dueDate: toDbDate(i.dueDate),
          amountCents: i.amountCents,
          principalCents: i.principalCents,
          interestCents: i.interestCents,
          feeCents: i.feeCents,
          arrangementId: arrangement.id,
          amountDueCents: i.amountCents,
          remainingCents: i.amountCents,
        })),
      });
      await tx.loan.update({
        where: { id },
        data: { scheduleVersion: newVersion, frequency: dto.frequency, instalmentCents: schedule.instalmentCents },
      });
      await this.ledger.recompute(tx, id, user.id);
      await this.audit.log(
        user.id,
        'REPAYMENT_ARRANGEMENT',
        'Loan',
        id,
        {
          reason: dto.reason,
          balanceCents: state.totalCents,
          arrearsCents: state.arrearsCents,
          supersededInstalments: open.length,
          newInstalments: dto.numberOfInstalments,
          frequency: dto.frequency,
          firstDueDate: dto.firstDueDate,
          instalmentCents: schedule.instalmentCents,
        },
        tx,
      );
      return arrangement;
    }, TX);
  }

  async addAdjustment(id: string, dto: LoanAdjustmentDto, user: AuthUser) {
    const today = todaySast();
    if (dto.effectiveDate > today) throw new BadRequestException('The effective date cannot be in the future');
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockLoan(tx, id))) throw new NotFoundException('Loan not found');
      const loan = await tx.loan.findUniqueOrThrow({ where: { id } });
      if (loan.status === 'CANCELLED') throw new BadRequestException('This loan was cancelled');
      if (dto.effectiveDate < fromDbDate(loan.disbursedOn)) throw new BadRequestException('The effective date is before the loan was disbursed');
      const adj = await tx.loanAdjustment.create({
        data: { loanId: id, kind: dto.kind, amountCents: dto.amountCents, effectiveDate: toDbDate(dto.effectiveDate), reason: dto.reason, authorisedById: user.id },
      });
      const { state } = await this.ledger.recompute(tx, id, user.id);
      const applied = state.adjustments.find((a) => a.adjustmentId === adj.id)?.appliedCents ?? 0;
      await this.audit.log(user.id, 'LOAN_ADJUSTMENT', 'Loan', id, { adjustmentId: adj.id, kind: dto.kind, amountCents: dto.amountCents, appliedCents: applied, effectiveDate: dto.effectiveDate, reason: dto.reason }, tx);
      if (dto.kind === 'PRINCIPAL_WRITE_OFF' && state.totalCents === 0) {
        await tx.loan.update({ where: { id }, data: { status: 'WRITTEN_OFF' } });
      }
      return { adjustment: adj, appliedCents: applied };
    }, TX);
  }

  async reverseAdjustment(id: string, adjustmentId: string, reason: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockLoan(tx, id))) throw new NotFoundException('Loan not found');
      const adj = await tx.loanAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adj || adj.loanId !== id) throw new NotFoundException('Adjustment not found');
      if (adj.reversedAt) throw new ConflictException('This adjustment was already reversed');
      await tx.loanAdjustment.update({ where: { id: adjustmentId }, data: { reversedAt: new Date(), reversedById: user.id, reversalReason: reason } });
      const loan = await tx.loan.findUniqueOrThrow({ where: { id } });
      if (loan.status === 'WRITTEN_OFF') await tx.loan.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.ledger.recompute(tx, id, user.id);
      await this.audit.log(user.id, 'LOAN_ADJUSTMENT_REVERSED', 'Loan', id, { adjustmentId, kind: adj.kind, amountCents: adj.amountCents, reason }, tx);
      return { ok: true };
    }, TX);
  }

  async cancel(id: string, reason: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockLoan(tx, id))) throw new NotFoundException('Loan not found');
      const payments = await tx.payment.count({ where: { loanId: id, status: { in: ['CONFIRMED', 'PENDING_VERIFICATION'] } } });
      if (payments) throw new BadRequestException('A loan with payments cannot be cancelled. Reverse the payments first, or use an adjustment.');
      const loan = await tx.loan.update({ where: { id }, data: { status: 'CANCELLED', arrearsCents: 0, nextDueDate: null, nextDueCents: 0 } });
      if (loan.applicationId) await tx.loanApplication.update({ where: { id: loan.applicationId }, data: { status: 'APPROVED' } });
      await this.audit.log(user.id, 'LOAN_CANCELLED', 'Loan', id, { reason }, tx);
      return loan;
    }, TX);
  }

  async addFollowUp(id: string, dto: FollowUpDto, user: AuthUser) {
    if (dto.outcome === 'PROMISE_TO_PAY' && !dto.promiseDate) throw new BadRequestException('Enter the date the client promised to pay');
    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id } });
      if (!loan) throw new NotFoundException('Loan not found');
      if (dto.instalmentId) {
        const inst = await tx.instalment.findUnique({ where: { id: dto.instalmentId } });
        if (!inst || inst.loanId !== id) throw new BadRequestException('Instalment not found on this loan');
        if (dto.outcome === 'CONFIRMED_MISSED' || dto.outcome === 'PROMISE_TO_PAY' || dto.outcome === 'PAYMENT_CLAIMED') {
          await tx.instalment.update({
            where: { id: inst.id },
            data: {
              collectionStatus: dto.outcome === 'CONFIRMED_MISSED' ? 'CONFIRMED_MISSED' : dto.outcome === 'PROMISE_TO_PAY' ? 'PROMISE_TO_PAY' : 'NONE',
              promiseDate: dto.promiseDate ? toDbDate(dto.promiseDate) : null,
            },
          });
        }
      }
      const note = await tx.followUpNote.create({
        data: {
          loanId: id,
          instalmentId: dto.instalmentId,
          outcome: dto.outcome,
          note: dto.note,
          promiseDate: dto.promiseDate ? toDbDate(dto.promiseDate) : null,
          createdById: user.id,
        },
      });
      await this.audit.log(user.id, 'FOLLOW_UP', 'Loan', id, { outcome: dto.outcome, instalmentId: dto.instalmentId, promiseDate: dto.promiseDate }, tx);
      return note;
    });
  }
}
