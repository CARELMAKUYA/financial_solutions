import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { addDays, diffDays, fromDbDate, sastClock, startOfWeek, todaySast, toDbDate } from '../common/dates';
import { formatDate, formatRand, lockLoan, METHOD_LABEL } from '../common/util';
import { LedgerService } from '../loans/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';

const TICK_MS = 5 * 60_000;

type NewNotification = Omit<Prisma.NotificationCreateManyInput, 'emailStatus'>;

/**
 * Runs on a timer inside the API process, so reminders go out whether or not anyone is signed in.
 * Every reminder has a unique `dedupeKey` (enforced by the database), so running the job twice,
 * on two servers, or after a restart never creates a duplicate. If the server was down when a
 * reminder was due, the next run catches up.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Reminders');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.JOBS_ENABLED === 'false' || process.env.NODE_ENV === 'test') return;
    const tick = () => void this.run().catch((e) => this.log.error(`Reminder run failed: ${e instanceof Error ? e.message : e}`));
    setTimeout(tick, 10_000);
    this.timer = setInterval(tick, TICK_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: refresh date-driven loan state, then create any reminders that are due, then email them. */
  async run(now: Date = new Date()) {
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      const today = todaySast(now);
      const refreshed = await this.refreshLoans(today);
      const settings = await this.settings.get();
      const { hour, weekday } = sastClock(now);
      const created: string[] = [];
      if (hour >= settings.reminderHour) {
        const batch: NewNotification[] = [];
        batch.push(...(await this.instalmentReminders(today, settings)));
        if (settings.dailySummary) batch.push(...(await this.dailySummary(today)));
        if (settings.weeklySummary && weekday === 1) batch.push(...(await this.weeklySummary(today)));
        if (batch.length) {
          // Insert one by one so we know exactly which ones are new (skipDuplicates doesn't say).
          for (const n of batch) {
            try {
              await this.prisma.notification.create({ data: { ...n, emailStatus: settings.emailEnabled ? 'PENDING' : 'NOT_SENT' } });
              created.push(n.dedupeKey);
            } catch (e) {
              if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
            }
          }
        }
      }
      const emailed = settings.emailEnabled ? await this.sendPendingEmails() : 0;
      if (created.length || refreshed) this.log.log(`Refreshed ${refreshed} loan(s), created ${created.length} reminder(s), emailed ${emailed}`);
      return { today, refreshed, created: created.length, emailed };
    } finally {
      this.running = false;
    }
  }

  /** Statuses like "Due today" and "Overdue" change with the date, so every active loan is recomputed once a day. */
  private async refreshLoans(today: string) {
    const startOfToday = new Date(`${today}T00:00:00+02:00`);
    const stale = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', OR: [{ recomputedAt: null }, { recomputedAt: { lt: startOfToday } }] },
      select: { id: true },
      take: 2000,
    });
    for (const { id } of stale) {
      await this.prisma.$transaction(
        async (tx) => {
          await lockLoan(tx, id);
          await this.ledger.recompute(tx, id, null, today);
        },
        { timeout: 20_000 },
      );
    }
    return stale.length;
  }

  private async instalmentReminders(today: string, s: Awaited<ReturnType<SettingsService['get']>>): Promise<NewNotification[]> {
    const horizon = addDays(today, s.reminderDaysBefore);
    // Look back far enough to catch up after downtime and to cover repeat reminders.
    const lookback = addDays(today, -Math.max(3, s.overdueRepeatDays * 12 + 1));
    const rows = await this.prisma.instalment.findMany({
      where: {
        supersededOn: null,
        remainingCents: { gt: 0 },
        status: { notIn: ['PAID', 'RESCHEDULED'] },
        dueDate: { gte: toDbDate(lookback), lte: toDbDate(horizon) },
        loan: { status: 'ACTIVE' },
      },
      include: { loan: { select: { id: true, reference: true, client: { select: { firstName: true, lastName: true, phone: true } } } } },
    });
    const out: NewNotification[] = [];
    for (const i of rows) {
      const due = fromDbDate(i.dueDate);
      const who = `${i.loan.client.firstName} ${i.loan.client.lastName}`;
      const base = { loanId: i.loan.id, instalmentId: i.id };
      const amount = formatRand(i.remainingCents);
      const days = diffDays(today, due); // > 0: days until due; < 0: days overdue
      if (days > 0 && s.remindDueSoon) {
        out.push({
          ...base,
          type: 'DUE_SOON',
          title: `${who}: ${amount} due ${days === 1 ? 'tomorrow' : `in ${days} days`}`,
          body: `Instalment ${i.seq} on ${i.loan.reference} is due on ${formatDate(due)}. Client phone: ${i.loan.client.phone}.`,
          dedupeKey: `DUE_SOON:${i.id}:${due}`,
        });
      } else if (days === 0 && s.remindDueToday) {
        out.push({
          ...base,
          type: 'DUE_TODAY',
          title: `${who}: ${amount} due today`,
          body: `Instalment ${i.seq} on ${i.loan.reference} is due today. Record the payment once the money has been received.`,
          dedupeKey: `DUE_TODAY:${i.id}:${due}`,
        });
      } else if (days < 0 && s.remindDayAfter) {
        const overdue = -days;
        // Day-after reminder, then every `overdueRepeatDays` days (checkpoints 1, 1+r, 1+2r...).
        const r = s.overdueRepeatDays;
        const checkpoint = r > 0 ? 1 + Math.floor((overdue - 1) / r) * r : 1;
        if (r === 0 && overdue > 3) continue; // Only catch up a missed day-after reminder for a few days.
        out.push({
          ...base,
          type: 'OVERDUE',
          title: `${who}: ${amount} overdue (${overdue} day${overdue === 1 ? '' : 's'})`,
          body: `Instalment ${i.seq} on ${i.loan.reference} was due on ${formatDate(due)} and is unpaid. Check whether a payment was received but not yet recorded, then follow up.`,
          dedupeKey: `OVERDUE:${i.id}:${checkpoint}`,
        });
      }
    }
    return out;
  }

  private async dailySummary(today: string): Promise<NewNotification[]> {
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', arrearsCents: { gt: 0 } },
      orderBy: { arrearsCents: 'desc' },
      include: { client: { select: { firstName: true, lastName: true } } },
    });
    const total = loans.reduce((s, l) => s + l.arrearsCents, 0);
    const lines = loans
      .slice(0, 15)
      .map((l) => `• ${l.client.firstName} ${l.client.lastName} (${l.reference}): ${formatRand(l.arrearsCents)}, ${l.oldestArrearsDate ? diffDays(fromDbDate(l.oldestArrearsDate), today) : 0} days`);
    return [
      {
        type: 'DAILY_OVERDUE_SUMMARY',
        title: loans.length ? `${loans.length} loan${loans.length === 1 ? '' : 's'} overdue: ${formatRand(total)}` : 'No overdue repayments today',
        body: loans.length ? `Overdue repayments on ${formatDate(today)}:\n${lines.join('\n')}${loans.length > 15 ? `\n…and ${loans.length - 15} more` : ''}` : `Every active loan is up to date as of ${formatDate(today)}.`,
        dedupeKey: `DAILY_OVERDUE:${today}`,
      },
    ];
  }

  private async weeklySummary(today: string): Promise<NewNotification[]> {
    const thisMonday = startOfWeek(today);
    const lastMonday = addDays(thisMonday, -7);
    const lastSunday = addDays(thisMonday, -1);
    const [payments, dueThisWeek, arrears, settled] = await Promise.all([
      this.prisma.payment.findMany({ where: { status: 'CONFIRMED', paymentDate: { gte: toDbDate(lastMonday), lte: toDbDate(lastSunday) } }, select: { amountCents: true, method: true } }),
      this.prisma.instalment.aggregate({
        where: { supersededOn: null, remainingCents: { gt: 0 }, dueDate: { gte: toDbDate(thisMonday), lte: toDbDate(addDays(thisMonday, 6)) }, loan: { status: 'ACTIVE' } },
        _sum: { remainingCents: true },
        _count: true,
      }),
      this.prisma.loan.aggregate({ where: { status: 'ACTIVE', arrearsCents: { gt: 0 } }, _sum: { arrearsCents: true }, _count: true }),
      this.prisma.loan.count({ where: { settledOn: { gte: toDbDate(lastMonday), lte: toDbDate(lastSunday) } } }),
    ]);
    const total = payments.reduce((s, p) => s + p.amountCents, 0);
    const byMethod = (['CASH', 'EFT', 'BANK_DEPOSIT'] as const)
      .map((m) => {
        const c = payments.filter((p) => p.method === m).reduce((s, p) => s + p.amountCents, 0);
        return c ? `${METHOD_LABEL[m]} ${formatRand(c)}` : null;
      })
      .filter(Boolean)
      .join(', ');
    return [
      {
        type: 'WEEKLY_COLLECTION_SUMMARY',
        title: `Weekly collections: ${formatRand(total)} received`,
        body:
          `Week ${formatDate(lastMonday)} – ${formatDate(lastSunday)}: ${payments.length} payment${payments.length === 1 ? '' : 's'} totalling ${formatRand(total)}${byMethod ? ` (${byMethod})` : ''}. ` +
          `${settled} loan${settled === 1 ? '' : 's'} settled.\n` +
          `This week: ${dueThisWeek._count} instalment${dueThisWeek._count === 1 ? '' : 's'} due, ${formatRand(dueThisWeek._sum.remainingCents ?? 0)}.\n` +
          `In arrears: ${arrears._count} loan${arrears._count === 1 ? '' : 's'}, ${formatRand(arrears._sum.arrearsCents ?? 0)}.`,
        dedupeKey: `WEEKLY:${thisMonday}`,
      },
    ];
  }

  /** Sends all pending notifications as one digest email to administrators who opted in. */
  private async sendPendingEmails(): Promise<number> {
    const pending = await this.prisma.notification.findMany({ where: { emailStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200 });
    if (!pending.length) return 0;
    if (!process.env.SMTP_HOST) {
      await this.mark(pending, 'FAILED', 'Email is enabled in settings but SMTP is not configured on the server');
      return 0;
    }
    const recipients = await this.prisma.user.findMany({ where: { active: true, receiveEmails: true }, select: { email: true } });
    if (!recipients.length) {
      await this.mark(pending, 'FAILED', 'No administrators have reminder emails switched on');
      return 0;
    }
    const s = await this.settings.get();
    try {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      const order: NotificationType[] = ['DAILY_OVERDUE_SUMMARY', 'WEEKLY_COLLECTION_SUMMARY', 'OVERDUE', 'DUE_TODAY', 'DUE_SOON', 'VERIFICATION_NEEDED', 'OVERPAYMENT', 'LOAN_SETTLED'];
      const sorted = [...pending].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      const text = sorted.map((n) => `${n.title}\n${n.body}`).join('\n\n— — —\n\n');
      const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:640px">
        <div style="border-bottom:2px solid #B8913A;padding-bottom:8px;margin-bottom:16px"><strong style="letter-spacing:2px">${escapeHtml(s.companyName.toUpperCase())}</strong><br><em style="color:#B8913A">${escapeHtml(s.tagline)}</em></div>
        ${sorted.map((n) => `<p style="margin:0 0 4px"><strong>${escapeHtml(n.title)}</strong></p><p style="margin:0 0 16px;white-space:pre-line;color:#444">${escapeHtml(n.body)}</p>`).join('')}
        <p style="color:#888;font-size:12px">Sign in to the loan system to record payments and follow up.</p></div>`;
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: recipients.map((r) => r.email),
        subject: `${s.companyName}: ${pending.length} repayment reminder${pending.length === 1 ? '' : 's'}`,
        text,
        html,
      });
      await this.mark(pending, 'SENT');
      return pending.length;
    } catch (e) {
      await this.mark(pending, 'FAILED', e instanceof Error ? e.message.slice(0, 300) : 'Unknown error');
      return 0;
    }
  }

  private mark(list: Notification[], status: 'SENT' | 'FAILED', error?: string) {
    return this.prisma.notification.updateMany({ where: { id: { in: list.map((n) => n.id) } }, data: { emailStatus: status, emailError: error ?? null } });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
