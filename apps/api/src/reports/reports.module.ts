import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, Res } from '@nestjs/common';
import { InstalmentStatus, PaymentMethod, Prisma } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { AuditService } from '../common/audit.service';
import { addDays, diffDays, fromDbDate, startOfMonth, todaySast, toDbDate } from '../common/dates';
import { AuthUser, CurrentUser } from '../common/decorators';
import { IsDateOnly } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';

/** Status of an instalment relative to today (statuses stored on rows are refreshed daily, this is always current). */
export function liveStatus(i: { dueDate: Date; remainingCents: number; paidCents: number; status: InstalmentStatus }, loanStatus: string, today: string): InstalmentStatus {
  if (i.status === 'RESCHEDULED') return 'RESCHEDULED';
  if (loanStatus === 'SETTLED' || i.status === 'PAID' || i.remainingCents === 0) return 'PAID';
  const due = fromDbDate(i.dueDate);
  if (due < today) return 'OVERDUE';
  if (i.paidCents > 0) return 'PARTIALLY_PAID';
  return due === today ? 'DUE_TODAY' : 'UPCOMING';
}

const AGING = [
  { key: '1-7', min: 1, max: 7 },
  { key: '8-30', min: 8, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '90+', min: 91, max: 100_000 },
];

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n');
}
const rand = (c: number) => (c / 100).toFixed(2);

function sendCsv(res: Response, name: string, rows: (string | number | null | undefined)[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  // BOM so Excel opens it as UTF-8.
  res.end(`﻿${csv(rows)}`);
}

class OverdueQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Max(100_000) maxDays?: number;
  @IsOptional() @IsIn(['NOT_RECORDED', 'PROMISE_TO_PAY', 'CONFIRMED_MISSED', 'PART_PAID', 'UNPAID', 'AWAITING_VERIFICATION']) status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['csv']) format?: string;
}

class RangeQuery {
  @IsDateOnly() from: string;
  @IsDateOnly() to: string;
  @IsOptional() @IsIn(['csv']) format?: string;
}

class ReconcileDto {
  @IsDateOnly() date: string;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsInt() @Min(0) actualCents: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overdue(q: OverdueQuery) {
    const today = todaySast();
    const rows = await this.prisma.instalment.findMany({
      where: {
        supersededOn: null,
        dueDate: { lt: toDbDate(today) },
        remainingCents: { gt: 0 },
        status: { notIn: ['PAID', 'RESCHEDULED'] },
        loan: { status: 'ACTIVE' },
        ...(q.minDays ? { dueDate: { lte: toDbDate(addDays(today, -q.minDays)) } } : {}),
        ...(q.search
          ? {
              OR: [
                { loan: { reference: { contains: q.search, mode: 'insensitive' } } },
                { loan: { client: { lastName: { contains: q.search, mode: 'insensitive' } } } },
                { loan: { client: { firstName: { contains: q.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: { dueDate: 'asc' },
      include: {
        loan: {
          select: {
            id: true,
            reference: true,
            lastPaymentDate: true,
            arrearsCents: true,
            totalOutstandingCents: true,
            pendingVerificationCents: true,
            client: { select: { id: true, firstName: true, lastName: true, phone: true, altPhone: true, email: true } },
          },
        },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });
    let list = rows.map((r) => {
      const daysOverdue = diffDays(fromDbDate(r.dueDate), today);
      const awaitingVerification = r.loan.pendingVerificationCents > 0;
      // Distinguish "nothing recorded yet" from "confirmed missed" (and from a payment that's been captured but not verified).
      const recordingStatus = r.collectionStatus === 'CONFIRMED_MISSED' ? 'CONFIRMED_MISSED' : r.collectionStatus === 'PROMISE_TO_PAY' ? 'PROMISE_TO_PAY' : awaitingVerification ? 'AWAITING_VERIFICATION' : 'NOT_RECORDED';
      return {
        instalmentId: r.id,
        seq: r.seq,
        version: r.version,
        dueDate: fromDbDate(r.dueDate),
        amountDueCents: r.amountDueCents,
        paidCents: r.paidCents,
        remainingCents: r.remainingCents,
        daysOverdue,
        collectionStatus: r.collectionStatus,
        recordingStatus,
        promiseDate: r.promiseDate ? fromDbDate(r.promiseDate) : null,
        loan: { ...r.loan, lastPaymentDate: r.loan.lastPaymentDate ? fromDbDate(r.loan.lastPaymentDate) : null },
        followUps: r.followUps,
      };
    });
    if (q.maxDays !== undefined) list = list.filter((r) => r.daysOverdue <= q.maxDays!);
    if (q.status === 'PART_PAID') list = list.filter((r) => r.paidCents > 0);
    else if (q.status === 'UNPAID') list = list.filter((r) => r.paidCents === 0);
    else if (q.status) list = list.filter((r) => r.recordingStatus === q.status);
    return list;
  }

  overdueCsv(list: Awaited<ReturnType<ReportsService['overdue']>>) {
    return [
      ['Client', 'Phone', 'Email', 'Loan', 'Instalment', 'Due date', 'Instalment amount', 'Paid', 'Overdue amount', 'Days overdue', 'Last payment', 'Status', 'Latest note'],
      ...list.map((r) => [
        `${r.loan.client.firstName} ${r.loan.client.lastName}`,
        r.loan.client.phone,
        r.loan.client.email,
        r.loan.reference,
        r.seq,
        r.dueDate,
        rand(r.amountDueCents),
        rand(r.paidCents),
        rand(r.remainingCents),
        r.daysOverdue,
        r.loan.lastPaymentDate,
        r.recordingStatus,
        r.followUps[0]?.note,
      ]),
    ];
  }

  async calendar(from: string, to: string) {
    if (diffDays(from, to) > 62) throw new BadRequestException('Choose a range of at most two months');
    const today = todaySast();
    const rows = await this.prisma.instalment.findMany({
      where: { supersededOn: null, dueDate: { gte: toDbDate(from), lte: toDbDate(to) }, loan: { status: { not: 'CANCELLED' } } },
      orderBy: { dueDate: 'asc' },
      include: { loan: { select: { id: true, reference: true, status: true, client: { select: { firstName: true, lastName: true } } } } },
    });
    return rows.map((r) => ({
      instalmentId: r.id,
      loanId: r.loan.id,
      loanReference: r.loan.reference,
      clientName: `${r.loan.client.firstName} ${r.loan.client.lastName}`,
      seq: r.seq,
      dueDate: fromDbDate(r.dueDate),
      amountDueCents: r.amountDueCents,
      paidCents: r.paidCents,
      remainingCents: r.loan.status === 'SETTLED' ? 0 : r.remainingCents,
      status: liveStatus(r, r.loan.status, today),
    }));
  }

  async dashboard() {
    const today = todaySast();
    const monthStart = startOfMonth(today);
    const weekEnd = addDays(today, 7);
    const [active, settledThisMonth, collectedToday, collectedMonth, dueToday, dueWeek, pendingVerification, overpayments, overdueRows, recent, unread, applications] = await Promise.all([
      this.prisma.loan.aggregate({
        where: { status: 'ACTIVE' },
        _count: true,
        _sum: { totalOutstandingCents: true, arrearsCents: true, principalOutstandingCents: true },
      }),
      this.prisma.loan.count({ where: { status: 'SETTLED', settledOn: { gte: toDbDate(monthStart) } } }),
      this.prisma.payment.aggregate({ where: { status: 'CONFIRMED', paymentDate: toDbDate(today) }, _sum: { amountCents: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { status: 'CONFIRMED', paymentDate: { gte: toDbDate(monthStart), lte: toDbDate(today) } }, _sum: { amountCents: true }, _count: true }),
      this.prisma.instalment.aggregate({
        where: { supersededOn: null, dueDate: toDbDate(today), remainingCents: { gt: 0 }, loan: { status: 'ACTIVE' } },
        _sum: { remainingCents: true },
        _count: true,
      }),
      this.prisma.instalment.aggregate({
        where: { supersededOn: null, dueDate: { gt: toDbDate(today), lte: toDbDate(weekEnd) }, remainingCents: { gt: 0 }, loan: { status: 'ACTIVE' } },
        _sum: { remainingCents: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({ where: { status: 'PENDING_VERIFICATION' }, _sum: { amountCents: true }, _count: true }),
      this.prisma.payment.count({ where: { overpaymentFlag: true, overpaymentResolvedAt: null } }),
      this.prisma.loan.findMany({ where: { status: 'ACTIVE', arrearsCents: { gt: 0 } }, select: { oldestArrearsDate: true, arrearsCents: true } }),
      this.prisma.payment.findMany({
        orderBy: { recordedAt: 'desc' },
        take: 8,
        include: { loan: { select: { id: true, reference: true, client: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.notification.count({ where: { readAt: null } }),
      this.prisma.loanApplication.count({ where: { status: { in: ['PENDING', 'APPROVED'] } } }),
    ]);
    const aging = AGING.map((b) => {
      const inBucket = overdueRows.filter((r) => {
        const d = r.oldestArrearsDate ? diffDays(fromDbDate(r.oldestArrearsDate), today) : 0;
        return d >= b.min && d <= b.max;
      });
      return { bucket: b.key, loans: inBucket.length, arrearsCents: inBucket.reduce((s, r) => s + r.arrearsCents, 0) };
    });
    return {
      today,
      activeLoans: active._count,
      totalOutstandingCents: active._sum.totalOutstandingCents ?? 0,
      principalOutstandingCents: active._sum.principalOutstandingCents ?? 0,
      arrearsCents: active._sum.arrearsCents ?? 0,
      loansInArrears: overdueRows.length,
      collectedTodayCents: collectedToday._sum.amountCents ?? 0,
      collectedTodayCount: collectedToday._count,
      collectedMonthCents: collectedMonth._sum.amountCents ?? 0,
      collectedMonthCount: collectedMonth._count,
      dueTodayCents: dueToday._sum.remainingCents ?? 0,
      dueTodayCount: dueToday._count,
      dueWeekCents: dueWeek._sum.remainingCents ?? 0,
      dueWeekCount: dueWeek._count,
      pendingVerificationCents: pendingVerification._sum.amountCents ?? 0,
      pendingVerificationCount: pendingVerification._count,
      overpaymentsToReview: overpayments,
      settledThisMonth,
      openApplications: applications,
      unreadNotifications: unread,
      aging,
      recentPayments: recent,
    };
  }

  async collections(from: string, to: string) {
    const payments = await this.prisma.payment.findMany({
      where: { status: 'CONFIRMED', paymentDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: {
        allocations: { where: { supersededAt: null } },
        loan: { select: { reference: true, client: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ paymentDate: 'asc' }, { recordedAt: 'asc' }],
    });
    const users = await this.prisma.user.findMany({ select: { id: true, name: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const comp = { INTEREST: 0, FEES: 0, PRINCIPAL: 0, OVERPAYMENT: 0 };
    const byMethod: Record<string, { count: number; cents: number }> = {};
    const byDay: Record<string, number> = {};
    const byAdmin: Record<string, { count: number; cents: number }> = {};
    for (const p of payments) {
      for (const a of p.allocations) comp[a.component] += a.amountCents;
      (byMethod[p.method] ??= { count: 0, cents: 0 }).count++;
      byMethod[p.method].cents += p.amountCents;
      const d = fromDbDate(p.paymentDate);
      byDay[d] = (byDay[d] ?? 0) + p.amountCents;
      const n = names[p.recordedById] ?? 'Unknown';
      (byAdmin[n] ??= { count: 0, cents: 0 }).count++;
      byAdmin[n].cents += p.amountCents;
    }
    // Collection rate: what fell due in the period versus what has been paid towards those instalments.
    const due = await this.prisma.instalment.aggregate({
      where: { supersededOn: null, dueDate: { gte: toDbDate(from), lte: toDbDate(to) }, loan: { status: { not: 'CANCELLED' } } },
      _sum: { amountDueCents: true, paidCents: true },
    });
    return {
      from,
      to,
      totalCents: payments.reduce((s, p) => s + p.amountCents, 0),
      count: payments.length,
      components: comp,
      byMethod,
      byDay: Object.entries(byDay).map(([date, cents]) => ({ date, cents })),
      byAdmin: Object.entries(byAdmin).map(([name, v]) => ({ name, ...v })),
      dueInPeriodCents: due._sum.amountDueCents ?? 0,
      paidTowardsDueCents: due._sum.paidCents ?? 0,
      payments: payments.map((p) => ({
        id: p.id,
        transactionNumber: p.transactionNumber,
        paymentDate: fromDbDate(p.paymentDate),
        loanReference: p.loan.reference,
        clientName: `${p.loan.client.firstName} ${p.loan.client.lastName}`,
        method: p.method,
        reference: p.reference,
        amountCents: p.amountCents,
        recordedBy: names[p.recordedById] ?? '—',
        interestCents: p.allocations.filter((a) => a.component === 'INTEREST').reduce((s, a) => s + a.amountCents, 0),
        feesCents: p.allocations.filter((a) => a.component === 'FEES').reduce((s, a) => s + a.amountCents, 0),
        principalCents: p.allocations.filter((a) => a.component === 'PRINCIPAL').reduce((s, a) => s + a.amountCents, 0),
        overpaymentCents: p.allocations.filter((a) => a.component === 'OVERPAYMENT').reduce((s, a) => s + a.amountCents, 0),
      })),
    };
  }

  async portfolio() {
    const today = todaySast();
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      include: { client: { select: { firstName: true, lastName: true, clientNumber: true } } },
      orderBy: { reference: 'asc' },
    });
    return loans.map((l) => ({
      id: l.id,
      reference: l.reference,
      clientName: `${l.client.firstName} ${l.client.lastName}`,
      clientNumber: l.client.clientNumber,
      product: l.product,
      disbursedOn: fromDbDate(l.disbursedOn),
      loanAmountCents: l.loanAmountCents,
      principalOutstandingCents: l.principalOutstandingCents,
      interestOutstandingCents: l.interestOutstandingCents,
      feesOutstandingCents: l.feesOutstandingCents,
      totalOutstandingCents: l.totalOutstandingCents,
      arrearsCents: l.arrearsCents,
      daysInArrears: l.oldestArrearsDate ? diffDays(fromDbDate(l.oldestArrearsDate), today) : 0,
      nextDueDate: l.nextDueDate ? fromDbDate(l.nextDueDate) : null,
      nextDueCents: l.nextDueCents,
      totalPaidCents: l.totalPaidCents,
    }));
  }

  async reconciliation(date: string) {
    const payments = await this.prisma.payment.findMany({
      where: { paymentDate: toDbDate(date) },
      orderBy: { recordedAt: 'asc' },
      include: { loan: { select: { id: true, reference: true, client: { select: { firstName: true, lastName: true } } } }, documents: { select: { id: true } } },
    });
    const recordedOn = await this.prisma.payment.count({
      where: { recordedAt: { gte: new Date(`${date}T00:00:00+02:00`), lt: new Date(`${addDays(date, 1)}T00:00:00+02:00`) }, paymentDate: { not: toDbDate(date) } },
    });
    const entries = await this.prisma.reconciliation.findMany({ where: { date: toDbDate(date) }, orderBy: { createdAt: 'desc' } });
    const users = await this.prisma.user.findMany({ select: { id: true, name: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const methods: PaymentMethod[] = ['CASH', 'EFT', 'BANK_DEPOSIT'];
    return {
      date,
      backdatedRecordedToday: recordedOn,
      methods: methods.map((m) => {
        const ps = payments.filter((p) => p.method === m);
        const latest = entries.find((e) => e.method === m);
        return {
          method: m,
          confirmedCents: ps.filter((p) => p.status === 'CONFIRMED').reduce((s, p) => s + p.amountCents, 0),
          pendingCents: ps.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((s, p) => s + p.amountCents, 0),
          count: ps.filter((p) => p.status === 'CONFIRMED' || p.status === 'PENDING_VERIFICATION').length,
          latest: latest ? { ...latest, reconciledBy: names[latest.reconciledById] ?? '—' } : null,
          history: entries.filter((e) => e.method === m).map((e) => ({ ...e, reconciledBy: names[e.reconciledById] ?? '—' })),
        };
      }),
      payments: payments.map((p) => ({ ...p, recordedByName: names[p.recordedById] ?? '—', hasProof: p.documents.length > 0 })),
    };
  }
}

@Controller()
class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('reports/dashboard')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('overdue')
  async overdue(@Query() q: OverdueQuery, @Res({ passthrough: true }) res: Response) {
    const list = await this.reports.overdue(q);
    if (q.format === 'csv') return sendCsv(res, `overdue-${todaySast()}.csv`, this.reports.overdueCsv(list));
    return list;
  }

  @Get('calendar')
  calendar(@Query() q: RangeQuery) {
    return this.reports.calendar(q.from, q.to);
  }

  @Get('reports/collections')
  async collections(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) {
    if (q.from > q.to) throw new BadRequestException('The start date must be before the end date');
    const r = await this.reports.collections(q.from, q.to);
    if (q.format === 'csv') {
      return sendCsv(res, `collections-${q.from}-to-${q.to}.csv`, [
        ['Date', 'Transaction', 'Loan', 'Client', 'Method', 'Reference', 'Amount', 'Interest', 'Fees', 'Principal', 'Overpayment', 'Recorded by'],
        ...r.payments.map((p) => [p.paymentDate, p.transactionNumber, p.loanReference, p.clientName, p.method, p.reference, rand(p.amountCents), rand(p.interestCents), rand(p.feesCents), rand(p.principalCents), rand(p.overpaymentCents), p.recordedBy]),
      ]);
    }
    return r;
  }

  @Get('reports/portfolio')
  async portfolio(@Query('format') format: string | undefined, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reports.portfolio();
    if (format === 'csv') {
      return sendCsv(res, `portfolio-${todaySast()}.csv`, [
        ['Loan', 'Client', 'Client no.', 'Product', 'Disbursed', 'Loan amount', 'Principal outstanding', 'Interest outstanding', 'Fees outstanding', 'Total outstanding', 'Arrears', 'Days in arrears', 'Next due', 'Next due amount', 'Total paid'],
        ...rows.map((l) => [l.reference, l.clientName, l.clientNumber, l.product, l.disbursedOn, rand(l.loanAmountCents), rand(l.principalOutstandingCents), rand(l.interestOutstandingCents), rand(l.feesOutstandingCents), rand(l.totalOutstandingCents), rand(l.arrearsCents), l.daysInArrears, l.nextDueDate, rand(l.nextDueCents), rand(l.totalPaidCents)]),
      ]);
    }
    return rows;
  }

  @Get('reconciliation')
  reconciliation(@Query('date') date?: string) {
    return this.reports.reconciliation(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todaySast());
  }

  @Post('reconciliation')
  async reconcile(@Body() dto: ReconcileDto, @CurrentUser() user: AuthUser) {
    if (dto.date > todaySast()) throw new BadRequestException('You cannot reconcile a future date');
    const day = await this.reports.reconciliation(dto.date);
    const recorded = day.methods.find((m) => m.method === dto.method)!.confirmedCents;
    const entry = await this.prisma.reconciliation.create({
      data: {
        date: toDbDate(dto.date),
        method: dto.method,
        recordedCents: recorded,
        actualCents: dto.actualCents,
        varianceCents: dto.actualCents - recorded,
        notes: dto.notes,
        reconciledById: user.id,
      },
    });
    await this.audit.log(user.id, 'RECONCILED', 'Reconciliation', entry.id, { date: dto.date, method: dto.method, recordedCents: recorded, actualCents: dto.actualCents, varianceCents: entry.varianceCents } as Prisma.InputJsonValue);
    return entry;
  }
}

@Module({ providers: [ReportsService], controllers: [ReportsController], exports: [ReportsService] })
export class ReportsModule {}
