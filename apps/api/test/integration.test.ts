/**
 * Integration tests against a real PostgreSQL database (`<name>_test`, created from DATABASE_URL).
 * Covers what the pure engine tests can't: transactions, duplicate submissions, concurrency,
 * reversals/corrections end to end, verification, append-only guards and the audit trail.
 *
 * Run: npm run test:integration -w api
 */
import '../src/env';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { config } from 'dotenv';

config({ path: `${__dirname}/../.env` });
const base = process.env.DATABASE_URL!;
const testUrl = base.replace(/\/([^/?]+)(\?|$)/, (_m, db: string, q: string) => `/${db}_test${q}`);
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

import { PrismaClient } from '@prisma/client';
import { addDays, addMonths, todaySast } from '../src/common/dates';
import type { AuthUser } from '../src/common/decorators';
import { ClientsService } from '../src/clients/clients.module';
import { createServices } from '../src/standalone';

const today = todaySast();
let svc: ReturnType<typeof createServices>;
let prisma: PrismaClient;
let owner: AuthUser;
let clerk: AuthUser;
let clientId: string;

const VALID_IDS = ['9001015009087', '8507225008085', '9201015800086', '8809095009081'];

async function newLoan(opts: { months?: number; n?: number; amount?: number; firstDueOffsetDays?: number; client?: string } = {}) {
  const disbursedOn = opts.months ? addMonths(today, -opts.months) : addDays(today, -10);
  return svc.loans.create(
    {
      clientId: opts.client ?? clientId,
      product: 'SHORT_TERM',
      loanAmountCents: opts.amount ?? 500_000,
      initiationFeeCents: 0,
      annualRateBps: 6000,
      serviceFeeCents: 6900,
      numberOfInstalments: opts.n ?? 4,
      frequency: 'MONTHLY',
      disbursedOn,
      firstDueDate: addDays(disbursedOn, opts.firstDueOffsetDays ?? 30),
    },
    owner,
  );
}

const pay = (loanId: string, amountCents: number, paymentDate = today, extra: Record<string, unknown> = {}) =>
  svc.payments.record(loanId, { amountCents, paymentDate, method: 'CASH', idempotencyKey: randomUUID(), ...extra }, clerk);

const loanRow = (id: string) => prisma.loan.findUniqueOrThrow({ where: { id } });
const schedule = (id: string) => prisma.instalment.findMany({ where: { loanId: id, supersededOn: null }, orderBy: [{ version: 'asc' }, { seq: 'asc' }] });

before(async () => {
  const dbName = new URL(testUrl).pathname.slice(1);
  // Fresh database for each run.
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  execSync('npx prisma migrate deploy', { cwd: `${__dirname}/..`, env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'ignore' });

  svc = createServices();
  prisma = svc.prisma;
  // Statement checks have their own tests below; off for everything else.
  await prisma.settings.create({ data: { id: 1, requiredStatementMonths: 0 } });
  const o = await prisma.user.create({ data: { name: 'Test Owner', email: 'owner@test.local', role: 'OWNER', canAuthoriseCorrections: true, passwordHash: 'x' } });
  const c = await prisma.user.create({ data: { name: 'Test Clerk', email: 'clerk@test.local', role: 'ADMIN', passwordHash: 'x' } });
  owner = { id: o.id, name: o.name, email: o.email, role: 'OWNER', canAuthoriseCorrections: true };
  clerk = { id: c.id, name: c.name, email: c.email, role: 'ADMIN', canAuthoriseCorrections: false };
  const client = await prisma.client.create({
    data: { clientNumber: 'TQC-T0001', firstName: 'Test', lastName: 'Client', idNumber: VALID_IDS[0], phone: '+27820000000', createdById: o.id },
  });
  clientId = client.id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('recording payments', () => {
  it('full instalment payment updates balance, instalment, allocations and audit in one go', async () => {
    const loan = await newLoan({ months: 1, firstDueOffsetDays: 25 });
    const [first] = await schedule(loan.id);
    const r = await pay(loan.id, first.amountCents, first.dueDate.toISOString().slice(0, 10));
    assert.equal(r.alreadyRecorded, false);
    const [inst] = await schedule(loan.id);
    assert.equal(inst.status, 'PAID');
    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: r.payment.id, supersededAt: null } });
    assert.equal(allocs.reduce((s, a) => s + a.amountCents, 0), first.amountCents);
    assert.deepEqual(new Set(allocs.map((a) => a.component)), new Set(['INTEREST', 'FEES', 'PRINCIPAL']));
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'Payment', entityId: r.payment.id, action: 'PAYMENT_RECORDED' } });
    assert.ok(audit, 'payment is in the audit trail');
    assert.equal(audit.userId, clerk.id);
  });

  it('partial payment: R 700 against R 1 250 shows Partially Paid with R 550 remaining', async () => {
    const loan = await newLoan({ firstDueOffsetDays: 20 });
    const [first] = await schedule(loan.id);
    await pay(loan.id, 70_000);
    const [inst] = await schedule(loan.id);
    assert.equal(inst.status, 'PARTIALLY_PAID');
    assert.equal(inst.paidCents, 70_000);
    assert.equal(inst.remainingCents, first.amountCents - 70_000);
  });

  it('multiple partial payments complete the instalment', async () => {
    const loan = await newLoan({ firstDueOffsetDays: 20 });
    const [first] = await schedule(loan.id);
    await pay(loan.id, 40_000, addDays(today, -2));
    await pay(loan.id, 30_000, addDays(today, -1));
    await pay(loan.id, first.amountCents - 70_000);
    const [inst] = await schedule(loan.id);
    assert.equal(inst.status, 'PAID');
  });

  it('a backdated payment is accepted and the loan is recalculated from that date', async () => {
    const loan = await newLoan({ months: 2, firstDueOffsetDays: 25 });
    const before = await loanRow(loan.id);
    assert.ok(before.arrearsCents > 0, 'loan starts in arrears');
    const [first] = await schedule(loan.id);
    const due = first.dueDate.toISOString().slice(0, 10);
    await pay(loan.id, first.amountCents, due);
    const [inst] = await schedule(loan.id);
    assert.equal(inst.status, 'PAID');
    assert.equal(inst.fullyPaidOn?.toISOString().slice(0, 10), due);
  });

  it('rejects future-dated payments and payments before disbursement', async () => {
    const loan = await newLoan();
    await assert.rejects(pay(loan.id, 1000, addDays(today, 1)), /future/);
    await assert.rejects(pay(loan.id, 1000, addDays(today, -60)), /before the loan was disbursed/);
  });
});

describe('duplicate submissions', () => {
  it('the same submission key never records twice (retries return the original)', async () => {
    const loan = await newLoan();
    const key = randomUUID();
    const a = await svc.payments.record(loan.id, { amountCents: 10_000, paymentDate: today, method: 'CASH', idempotencyKey: key }, clerk);
    const b = await svc.payments.record(loan.id, { amountCents: 10_000, paymentDate: today, method: 'CASH', idempotencyKey: key }, clerk);
    assert.equal(b.alreadyRecorded, true);
    assert.equal(a.payment.id, b.payment.id);
    assert.equal(await prisma.payment.count({ where: { loanId: loan.id } }), 1);
  });

  it('simultaneous double-clicks with the same key record exactly one payment', async () => {
    const loan = await newLoan();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.payments.record(loan.id, { amountCents: 12_345, paymentDate: today, method: 'EFT', idempotencyKey: key }, clerk)),
    );
    assert.equal(new Set(results.map((r) => r.payment.id)).size, 1);
    assert.equal(await prisma.payment.count({ where: { loanId: loan.id } }), 1);
  });

  it('a second payment with the same amount and date needs explicit confirmation', async () => {
    const loan = await newLoan();
    await pay(loan.id, 20_000);
    await assert.rejects(pay(loan.id, 20_000), (e: { response?: { code?: string } }) => e.response?.code === 'POSSIBLE_DUPLICATE');
    await pay(loan.id, 20_000, today, { confirmDuplicate: true });
    assert.equal(await prisma.payment.count({ where: { loanId: loan.id } }), 2);
  });

  it('concurrent different payments on one loan are serialised and both counted', async () => {
    const loan = await newLoan();
    await Promise.all([pay(loan.id, 11_000), pay(loan.id, 22_000), pay(loan.id, 33_000)]);
    const row = await loanRow(loan.id);
    assert.equal(row.totalPaidCents, 66_000);
    const allocs = await prisma.paymentAllocation.aggregate({ where: { loanId: loan.id, supersededAt: null }, _sum: { amountCents: true } });
    assert.equal(allocs._sum.amountCents, 66_000);
  });
});

describe('missed payments and overdue', () => {
  it('unpaid past instalments are overdue and listed with days overdue', async () => {
    const loan = await newLoan({ months: 3, firstDueOffsetDays: 20 });
    const row = await loanRow(loan.id);
    assert.ok(row.arrearsCents > 0);
    const list = await svc.reports.overdue({});
    const mine = list.filter((r) => r.loan.id === loan.id);
    assert.ok(mine.length >= 2);
    assert.ok(mine.every((r) => r.daysOverdue > 0 && r.recordingStatus === 'NOT_RECORDED'));
  });

  it('confirming a missed payment is distinct from "not yet recorded"', async () => {
    const loan = await newLoan({ months: 2, firstDueOffsetDays: 20 });
    const [first] = await schedule(loan.id);
    await svc.loans.addFollowUp(loan.id, { instalmentId: first.id, outcome: 'CONFIRMED_MISSED', note: 'Checked bank statement, nothing received' }, clerk);
    const list = await svc.reports.overdue({ status: 'CONFIRMED_MISSED' });
    assert.ok(list.some((r) => r.instalmentId === first.id));
    // Paying it clears the missed status.
    await pay(loan.id, first.amountCents);
    const inst = await prisma.instalment.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(inst.status, 'PAID');
    assert.equal(inst.collectionStatus, 'NONE');
  });

  it('payment recorded after the due date removes the overdue entry only once fully paid', async () => {
    const loan = await newLoan({ months: 1, firstDueOffsetDays: 20 });
    const [first] = await schedule(loan.id);
    await pay(loan.id, 10_000);
    let list = await svc.reports.overdue({});
    assert.ok(list.some((r) => r.instalmentId === first.id && r.paidCents === 10_000));
    await pay(loan.id, first.amountCents - 10_000);
    list = await svc.reports.overdue({});
    assert.ok(!list.some((r) => r.instalmentId === first.id));
  });
});

describe('early repayment, settlement and overpayment', () => {
  it('early settlement marks the loan Fully Paid, stops reminders and records the settlement date', async () => {
    const loan = await newLoan({ firstDueOffsetDays: 20 });
    const d = await svc.loans.detail(loan.id);
    await pay(loan.id, d.settlementQuote.totalCents);
    const row = await loanRow(loan.id);
    assert.equal(row.status, 'SETTLED');
    assert.equal(row.totalOutstandingCents, 0);
    assert.equal(row.settledOn?.toISOString().slice(0, 10), today);
    const notes = await prisma.notification.findMany({ where: { loanId: loan.id, type: 'LOAN_SETTLED' } });
    assert.equal(notes.length, 1);
    await svc.reminders.run(new Date(`${today}T10:00:00+02:00`));
    assert.equal(await prisma.notification.count({ where: { loanId: loan.id, type: { in: ['DUE_SOON', 'DUE_TODAY', 'OVERDUE'] } } }), 0);
  });

  it('overpayment never makes the balance negative and is flagged for review', async () => {
    const loan = await newLoan({ firstDueOffsetDays: 20 });
    const d = await svc.loans.detail(loan.id);
    const r = await pay(loan.id, d.settlementQuote.totalCents + 5_000);
    const row = await loanRow(loan.id);
    assert.equal(row.totalOutstandingCents, 0);
    assert.equal(row.overpaymentCents, 5_000);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.payment.id } });
    assert.equal(p.overpaymentFlag, true);
    await svc.payments.resolveOverpayment(p.id, { resolution: 'Refunded by EFT', refundCents: 5_000 }, owner);
    assert.equal((await loanRow(loan.id)).overpaymentCents, 0);
  });
});

describe('reversals and corrections', () => {
  it('reversing a payment restores arrears, keeps the original row and records the reason', async () => {
    const loan = await newLoan({ months: 1, firstDueOffsetDays: 20 });
    const [first] = await schedule(loan.id);
    const r = await pay(loan.id, first.amountCents);
    assert.equal((await loanRow(loan.id)).arrearsCents, 0);
    await svc.payments.reverse(r.payment.id, 'Captured on the wrong loan', owner);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.payment.id }, include: { adjustments: true } });
    assert.equal(p.status, 'REVERSED');
    assert.equal(p.amountCents, first.amountCents, 'original amount is kept');
    assert.equal(p.adjustments[0].reason, 'Captured on the wrong loan');
    assert.ok((await loanRow(loan.id)).arrearsCents > 0);
    // Old allocations are kept, marked superseded.
    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: p.id } });
    assert.ok(allocs.length > 0 && allocs.every((a) => a.supersededAt));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PAYMENT_REVERSED', entityId: p.id } }));
  });

  it('reversing the payment that settled a loan re-opens it', async () => {
    const loan = await newLoan({ firstDueOffsetDays: 20 });
    const d = await svc.loans.detail(loan.id);
    const r = await pay(loan.id, d.settlementQuote.totalCents);
    assert.equal((await loanRow(loan.id)).status, 'SETTLED');
    await svc.payments.reverse(r.payment.id, 'Payment bounced', owner);
    const row = await loanRow(loan.id);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.settledOn, null);
  });

  it('a correction reverses the original and links a replacement with the right amount', async () => {
    const loan = await newLoan();
    const r = await pay(loan.id, 9_000);
    const { replacement } = await svc.payments.correct(r.payment.id, { amountCents: 90_000, paymentDate: today, method: 'EFT', reason: 'Typed R 90 instead of R 900' }, owner);
    assert.equal(replacement.replacesPaymentId, r.payment.id);
    assert.equal((await loanRow(loan.id)).totalPaidCents, 90_000);
    const adj = await prisma.paymentAdjustment.findFirstOrThrow({ where: { paymentId: r.payment.id } });
    assert.equal(adj.kind, 'CORRECTION');
    assert.equal(adj.replacementPaymentId, replacement.id);
  });
});

describe('verification and reconciliation', () => {
  it('a payment flagged for verification does not affect balances until verified', async () => {
    const loan = await newLoan();
    const before = await loanRow(loan.id);
    const r = await pay(loan.id, 50_000, today, { requireVerification: true });
    assert.equal(r.payment.status, 'PENDING_VERIFICATION');
    const mid = await loanRow(loan.id);
    assert.equal(mid.totalPaidCents, 0);
    assert.equal(mid.pendingVerificationCents, 50_000);
    assert.equal(mid.totalOutstandingCents, before.totalOutstandingCents);
    await svc.payments.verify(r.payment.id, true, 'Seen on bank statement', owner);
    const after = await loanRow(loan.id);
    assert.equal(after.totalPaidCents, 50_000);
    assert.equal(after.pendingVerificationCents, 0);
  });

  it('a rejected payment never counts and cannot be reinstated', async () => {
    const loan = await newLoan();
    const r = await pay(loan.id, 50_000, today, { requireVerification: true });
    await svc.payments.verify(r.payment.id, false, 'Not on the bank statement', owner);
    assert.equal((await loanRow(loan.id)).totalPaidCents, 0);
    await assert.rejects(prisma.payment.update({ where: { id: r.payment.id }, data: { status: 'CONFIRMED' } }), /cannot be reinstated/);
  });

  it('daily reconciliation compares recorded totals with actual money received', async () => {
    const day = await svc.reports.reconciliation(today);
    const cash = day.methods.find((m) => m.method === 'CASH')!;
    assert.ok(cash.confirmedCents > 0);
  });
});

describe('append-only financial history (database guards)', () => {
  it('payment amounts and dates cannot be edited, and payments cannot be deleted', async () => {
    const loan = await newLoan();
    const r = await pay(loan.id, 1_000);
    await assert.rejects(prisma.payment.update({ where: { id: r.payment.id }, data: { amountCents: 2_000 } }), /cannot be edited/);
    await assert.rejects(prisma.payment.delete({ where: { id: r.payment.id } }), /not allowed/);
  });

  it('audit log entries cannot be changed or deleted', async () => {
    const entry = await prisma.auditLog.findFirstOrThrow();
    await assert.rejects(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'X' } }), /not allowed/);
    await assert.rejects(prisma.auditLog.delete({ where: { id: entry.id } }), /not allowed/);
  });
});

describe('multiple loans and repayment arrangements', () => {
  it('payments on one loan do not affect another loan of the same client', async () => {
    const a = await newLoan({ months: 1, firstDueOffsetDays: 20 });
    const b = await newLoan({ months: 1, firstDueOffsetDays: 20 });
    const [first] = await schedule(a.id);
    await pay(a.id, first.amountCents);
    assert.equal((await loanRow(a.id)).arrearsCents, 0);
    assert.ok((await loanRow(b.id)).arrearsCents > 0);
  });

  it('a repayment arrangement supersedes open instalments and clears arrears without changing the balance', async () => {
    const loan = await newLoan({ months: 3, firstDueOffsetDays: 20 });
    const before = await loanRow(loan.id);
    assert.ok(before.arrearsCents > 0);
    await svc.loans.createArrangement(loan.id, { firstDueDate: addDays(today, 14), numberOfInstalments: 6, frequency: 'MONTHLY', reason: 'Client lost overtime income; agreed lower instalments' }, owner);
    const after = await loanRow(loan.id);
    assert.equal(after.arrearsCents, 0);
    assert.equal(after.totalOutstandingCents, before.totalOutstandingCents);
    assert.equal(after.scheduleVersion, 2);
    const superseded = await prisma.instalment.count({ where: { loanId: loan.id, supersededOn: { not: null } } });
    assert.ok(superseded > 0);
    const active = await schedule(loan.id);
    assert.equal(active.filter((i) => i.version === 2).length, 6);
    // Paying the new schedule works as normal.
    const firstNew = active.find((i) => i.version === 2)!;
    await pay(loan.id, firstNew.amountCents);
    const updated = await prisma.instalment.findUniqueOrThrow({ where: { id: firstNew.id } });
    assert.equal(updated.status, 'PAID');
  });
});

describe('reminders', () => {
  it('creates due-soon, due-today, overdue and summary reminders once, never twice', async () => {
    await newLoan({ months: 1, firstDueOffsetDays: 20 }); // overdue
    const disbursed = addDays(today, -27);
    await svc.loans.create(
      { clientId, product: 'SHORT_TERM', loanAmountCents: 100_000, initiationFeeCents: 0, annualRateBps: 6000, serviceFeeCents: 0, numberOfInstalments: 2, frequency: 'MONTHLY', disbursedOn: disbursed, firstDueDate: addDays(today, 3) },
      owner,
    );
    const at = new Date(`${today}T09:00:00+02:00`);
    const first = await svc.reminders.run(at);
    assert.ok(first.created && first.created > 0);
    const second = await svc.reminders.run(at);
    assert.equal(second.created, 0, 'running again creates nothing new');
    const types = new Set((await prisma.notification.findMany()).map((n) => n.type));
    for (const t of ['DUE_SOON', 'OVERDUE', 'DAILY_OVERDUE_SUMMARY']) assert.ok(types.has(t as never), `has ${t}`);
  });
});

describe('bank statements', () => {
  const statement = (client: string, periodFrom: string, periodTo: string) =>
    prisma.loanDocument.create({
      data: { clientId: client, kind: 'BANK_STATEMENT', periodFrom, periodTo, fileName: 'statement.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: randomUUID(), uploadedById: owner.id },
    });
  const month = (offset: number) => addMonths(`${today.slice(0, 7)}-01`, offset).slice(0, 7);

  it('blocks issuing a loan until the 3 months before disbursement are covered', async () => {
    const c = await prisma.client.create({
      data: { clientNumber: 'TQC-T0100', firstName: 'Statement', lastName: 'Test', idNumber: VALID_IDS[3], phone: '+27820000100', createdById: owner.id },
    });
    await prisma.settings.update({ where: { id: 1 }, data: { requiredStatementMonths: 3 } });
    try {
      await assert.rejects(newLoan({ client: c.id }), /Bank statements are needed before issuing a loan/);
      // One file covering two months plus a single month: all three covered.
      await statement(c.id, month(-3), month(-2));
      await assert.rejects(newLoan({ client: c.id }), /missing/);
      await statement(c.id, month(-1), month(-1));
      // newLoan disburses 10 days ago; if that falls in last month the window shifts back one month.
      const disbursedMonth = addDays(today, -10).slice(0, 7);
      if (disbursedMonth < today.slice(0, 7)) await statement(c.id, month(-4), month(-4));
      const loan = await newLoan({ client: c.id });
      assert.ok(loan.id);
    } finally {
      await prisma.settings.update({ where: { id: 1 }, data: { requiredStatementMonths: 0 } });
    }
  });

  it('blocks approving an application without statements', async () => {
    const c = await prisma.client.create({
      data: { clientNumber: 'TQC-T0101', firstName: 'Approval', lastName: 'Test', idNumber: '8001015009080', phone: '+27820000101', createdById: owner.id },
    });
    const app = await prisma.loanApplication.create({
      data: { applicationNumber: 'TQA-T-00001', clientId: c.id, requestedAmountCents: 200_000, requestedInstalments: 2, createdById: owner.id },
    });
    await prisma.settings.update({ where: { id: 1 }, data: { requiredStatementMonths: 3 } });
    try {
      const clients = new ClientsService(svc.prisma, svc.audit);
      const decide = () => clients.decide(app.id, { status: 'APPROVED' }, owner);
      await assert.rejects(decide(), /approving this application/);
      assert.equal((await clients.getApplication(app.id)).statements?.missing.length, 3);
      await statement(c.id, month(-3), month(-1));
      assert.equal((await decide()).status, 'APPROVED');
      assert.equal((await clients.getApplication(app.id)).statements?.complete, true);
    } finally {
      await prisma.settings.update({ where: { id: 1 }, data: { requiredStatementMonths: 0 } });
    }
  });

  it('the database rejects an invalid statement period', async () => {
    await assert.rejects(statement(clientId, '2026-13', '2026-13'));
    await assert.rejects(statement(clientId, month(-1), month(-3)), /check/i);
    await assert.rejects(
      prisma.loanDocument.create({
        data: { clientId, kind: 'PAYSLIP', periodFrom: month(-1), periodTo: month(-1), fileName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: randomUUID(), uploadedById: owner.id },
      }),
    );
  });
});
