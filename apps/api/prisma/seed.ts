/**
 * Demo data: two administrators and a handful of fictitious clients with loans in different states
 * (on time, partially paid, overdue, settled early). Everything is created through the same services
 * the app uses, so balances and statuses are computed exactly as they would be for real data.
 *
 * Runs only against an empty database (no administrators yet).
 */
import '../src/env';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/auth.service';
import { AuthUser } from '../src/common/decorators';
import { addDays, addMonths, todaySast } from '../src/common/dates';
import { createServices } from '../src/standalone';

/** Builds a valid-format SA ID number (Luhn check digit) for a made-up person. */
function fakeId(dob: string, serial: number) {
  const base = `${dob}${String(serial).padStart(4, '0')}08`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(base[11 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${base}${(10 - (sum % 10)) % 10}`;
}

async function main() {
  const prisma = new PrismaClient();
  if ((await prisma.user.count()) > 0) {
    console.log('Administrators already exist; skipping the seed.');
    await prisma.$disconnect();
    return;
  }
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    // Statements are switched off while the demo loans are captured (they have none) and back on at the end.
    create: { id: 1, requiredStatementMonths: 0, phone: '+27 00 000 0000', email: 'info@example.co.za', address: 'Update the business address in Settings' },
  });
  const owner = await prisma.user.create({
    data: { name: 'Owner', email: 'owner@teeque.local', role: 'OWNER', canAuthoriseCorrections: true, passwordHash: await hashPassword('Owner@123456') },
  });
  await prisma.user.create({
    data: { name: 'Admin', email: 'admin@teeque.local', role: 'ADMIN', passwordHash: await hashPassword('Admin@123456') },
  });
  await prisma.$disconnect();

  const { prisma: db, loans, payments } = createServices();
  const user: AuthUser = { id: owner.id, name: owner.name, email: owner.email, role: 'OWNER', canAuthoriseCorrections: true };
  const today = todaySast();

  const people = [
    { firstName: 'Demo', lastName: 'Mokoena', dob: '900315', phone: '+27820000001', payday: 25 },
    { firstName: 'Demo', lastName: 'Naidoo', dob: '850722', phone: '+27820000002', payday: 25 },
    { firstName: 'Demo', lastName: 'Van Wyk', dob: '920101', phone: '+27820000003', payday: 15 },
    { firstName: 'Demo', lastName: 'Dlamini', dob: '880909', phone: '+27820000004', payday: 28 },
    { firstName: 'Demo', lastName: 'Botha', dob: '950505', phone: '+27820000005', payday: 25 },
  ];
  const clients = [];
  for (const [i, p] of people.entries()) {
    clients.push(
      await db.client.create({
        data: {
          clientNumber: `TQC-${String(i + 1).padStart(5, '0')}`,
          firstName: p.firstName,
          lastName: p.lastName,
          idNumber: fakeId(p.dob, 5000 + i),
          phone: p.phone,
          payday: p.payday,
          employer: 'Demo Employer (Pty) Ltd',
          monthlyIncomeCents: 1_200_000 + i * 150_000,
          notes: 'Fictitious demo client. Delete before real use.',
          createdById: owner.id,
        },
      }),
    );
  }
  await db.counter.upsert({ where: { name: 'client' }, update: { value: clients.length }, create: { name: 'client', value: clients.length } });

  const terms = (amount: number, n: number, disbursedOn: string, firstDue: string) => ({
    loanAmountCents: amount,
    initiationFeeCents: Math.min(Math.round(16_500 + amount * 0.1), 105_000),
    monthlyRateBps: 500,
    serviceFeeCents: 6900,
    numberOfInstalments: n,
    frequency: 'MONTHLY' as const,
    disbursedOn,
    firstDueDate: firstDue,
  });
  const pay = async (loanId: string, date: string, amountCents: number, method: 'CASH' | 'EFT' | 'BANK_DEPOSIT' = 'EFT') => {
    if (date > today) return;
    await payments.record(loanId, { amountCents, paymentDate: date, method, reference: method === 'CASH' ? undefined : `DEMO-${date}`, idempotencyKey: randomUUID(), confirmDuplicate: true }, user);
  };
  const instalments = async (loanId: string) => db.instalment.findMany({ where: { loanId }, orderBy: { seq: 'asc' } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // 1. Up to date: every instalment so far paid on its due date.
  const start1 = addMonths(today, -3);
  const l1 = await loans.create({ ...terms(500_000, 6, start1, addDays(start1, 24)), clientId: clients[0].id, product: 'SHORT_TERM' }, user);
  for (const i of await instalments(l1.id)) await pay(l1.id, iso(i.dueDate), i.amountCents);

  // 2. Partial payments: the last instalment was only part-paid.
  const start2 = addMonths(today, -2);
  const l2 = await loans.create({ ...terms(300_000, 4, start2, addDays(start2, 20)), clientId: clients[1].id, product: 'SHORT_TERM' }, user);
  const i2 = (await instalments(l2.id)).filter((i) => iso(i.dueDate) <= today);
  for (const [k, i] of i2.entries()) await pay(l2.id, iso(i.dueDate), k === i2.length - 1 ? Math.round(i.amountCents * 0.55) : i.amountCents, 'CASH');

  // 3. Missed: nothing paid since the first instalment.
  const start3 = addMonths(today, -3);
  const l3 = await loans.create({ ...terms(400_000, 6, start3, addDays(start3, 10)), clientId: clients[2].id, product: 'EMERGENCY_CASH' }, user);
  const first3 = (await instalments(l3.id))[0];
  await pay(l3.id, iso(first3.dueDate), first3.amountCents, 'BANK_DEPOSIT');

  // 4. Salary advance settled early.
  const start4 = addDays(today, -20);
  const l4 = await loans.create({ ...terms(150_000, 1, start4, addDays(start4, 25)), clientId: clients[3].id, product: 'SALARY_ADVANCE' }, user);
  const quote = (await loans.detail(l4.id)).settlementQuote;
  await pay(l4.id, today, quote.totalCents, 'EFT');

  // 5. New loan, first instalment due in 3 days (shows in the "due soon" reminders).
  const l5 = await loans.create({ ...terms(250_000, 3, addDays(today, -25), addDays(today, 3)), clientId: clients[4].id, product: 'SHORT_TERM' }, user);
  void l5;

  await db.settings.update({ where: { id: 1 }, data: { requiredStatementMonths: 3 } });

  await db.$disconnect();
  console.log('Seeded demo data. Sign in as owner@teeque.local / Owner@123456 (change this password immediately).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
