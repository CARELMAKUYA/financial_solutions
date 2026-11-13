/**
 * Ledger engine tests: the repayment scenarios from the brief, run against the pure engine.
 * Database-level behaviour (duplicate submissions, transactions, audit trail, reversals end to end)
 * is covered in integration.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../src/common/dates';
import {
  buildSchedule,
  computeLedger,
  EngineAdjustment,
  EngineInput,
  EngineInstalment,
  EnginePayment,
  flatInterest,
  previewPayment,
} from '../src/loans/engine';

// R 5 000 over 4 monthly instalments at 5% per month flat, R 69 service fee, disbursed 1 Jan 2026:
// R 250 interest a month, R 1 250 principal a month, R 1 569 an instalment, R 6 276 in total.
const TERMS = {
  principalCents: 500_000,
  monthlyRateBps: 500,
  startDate: '2026-01-01',
  firstDueDate: '2026-01-25',
  instalments: 4,
  frequency: 'MONTHLY' as const,
  serviceFeeCents: 6900,
};
const schedule = buildSchedule(TERMS);
const INST: EngineInstalment[] = schedule.instalments.map((i) => ({
  id: `i${i.seq}`,
  seq: i.seq,
  dueDate: i.dueDate,
  amountCents: i.amountCents,
  feeCents: i.feeCents,
  interestCents: i.interestCents,
  superseded: false,
}));
const due = (seq: number) => INST[seq - 1].dueDate;
const amt = (seq: number) => INST[seq - 1].amountCents;

let n = 0;
const pay = (date: string, amountCents: number): EnginePayment => ({ id: `p${++n}`, date, amountCents, order: String(n).padStart(6, '0') });
const adj = (date: string, kind: EngineAdjustment['kind'], amountCents: number): EngineAdjustment => ({ id: `a${++n}`, date, kind, amountCents, order: String(n) });

function ledger(payments: EnginePayment[], asOf: string, extra: Partial<EngineInput> = {}) {
  return computeLedger({
    principalDebtCents: TERMS.principalCents,
    disbursedOn: TERMS.startDate,
    instalments: INST,
    payments,
    adjustments: [],
    inDuplum: true,
    asOf,
    ...extra,
  });
}

describe('schedule', () => {
  it('charges flat monthly interest on the original amount: 5% of R 5 000 = R 250 every month', () => {
    assert.deepEqual(schedule.instalments.map((i) => i.interestCents), [25_000, 25_000, 25_000, 25_000]);
    assert.deepEqual(schedule.instalments.map((i) => i.principalCents), [125_000, 125_000, 125_000, 125_000]);
    assert.deepEqual(schedule.instalments.map((i) => i.amountCents), [156_900, 156_900, 156_900, 156_900]);
    assert.equal(schedule.totalInterestCents, 100_000);
    assert.equal(schedule.totalRepayableCents, 627_600);
  });

  it('R 2 000 over 3 months at 5%: R 300 interest, the last instalment takes the rounding cents', () => {
    const s = buildSchedule({ ...TERMS, principalCents: 200_000, instalments: 3, serviceFeeCents: 0 });
    assert.equal(s.totalInterestCents, 30_000);
    assert.deepEqual(s.instalments.map((i) => i.amountCents), [76_666, 76_666, 76_668]);
    assert.equal(s.totalRepayableCents, 230_000);
  });

  it('weekly and fortnightly instalments charge the matching part of a month', () => {
    const weekly = buildSchedule({ ...TERMS, frequency: 'WEEKLY', firstDueDate: '2026-01-08', instalments: 3 });
    assert.equal(weekly.totalInterestCents, flatInterest(500_000, 500, (3 * 12) / 52));
    assert.equal(weekly.totalInterestCents, 17_308);
    const fortnightly = buildSchedule({ ...TERMS, frequency: 'FORTNIGHTLY', firstDueDate: '2026-01-15', instalments: 2 });
    assert.equal(fortnightly.totalInterestCents, flatInterest(500_000, 500, (2 * 12) / 26));
  });

  it('builds level instalments that clear the debt exactly when paid on time', () => {
    assert.equal(schedule.instalments.length, 4);
    assert.deepEqual(
      schedule.instalments.map((i) => i.dueDate),
      ['2026-01-25', '2026-02-25', '2026-03-25', '2026-04-25'],
    );
    const [a, b, c] = schedule.instalments;
    assert.equal(a.amountCents, b.amountCents);
    assert.equal(b.amountCents, c.amountCents);
    assert.equal(schedule.instalments.at(-1)!.closingPrincipalCents, 0);
    const principalSum = schedule.instalments.reduce((s, i) => s + i.principalCents, 0);
    assert.equal(principalSum, TERMS.principalCents);
    assert.equal(schedule.totalRepayableCents, schedule.instalments.reduce((s, i) => s + i.amountCents, 0));
  });

  it('clamps monthly due dates to the end of short months and keeps the anchor day', () => {
    const s = buildSchedule({ ...TERMS, firstDueDate: '2026-01-31', instalments: 3 });
    assert.deepEqual(s.instalments.map((i) => i.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('supports weekly and fortnightly frequencies', () => {
    assert.deepEqual(
      buildSchedule({ ...TERMS, frequency: 'WEEKLY', firstDueDate: '2026-01-08', instalments: 3 }).instalments.map((i) => i.dueDate),
      ['2026-01-08', '2026-01-15', '2026-01-22'],
    );
    assert.deepEqual(
      buildSchedule({ ...TERMS, frequency: 'FORTNIGHTLY', firstDueDate: '2026-01-15', instalments: 2 }).instalments.map((i) => i.dueDate),
      ['2026-01-15', '2026-01-29'],
    );
  });

  it('salary advance: a single instalment repays principal, interest and fee', () => {
    const s = buildSchedule({ ...TERMS, instalments: 1 });
    assert.equal(s.instalments[0].amountCents, 500_000 + 25_000 + 6900);
  });

  it('rejects invalid terms', () => {
    assert.throws(() => buildSchedule({ ...TERMS, principalCents: 0 }));
    assert.throws(() => buildSchedule({ ...TERMS, firstDueDate: '2026-01-01' }));
    assert.throws(() => buildSchedule({ ...TERMS, instalments: 0 }));
  });
});

describe('full instalment payment', () => {
  it('pays the instalment, allocates interest → fees → principal and keeps the rest of the loan open', () => {
    const p = pay(due(1), amt(1));
    const s = ledger([p], due(1));
    const a = s.allocations[0];
    assert.equal(a.interestCents, schedule.instalments[0].interestCents);
    assert.equal(a.feesCents, 6900);
    assert.equal(a.principalCents, schedule.instalments[0].principalCents);
    assert.equal(a.overpaymentCents, 0);
    assert.equal(s.instalments[0].status, 'PAID');
    assert.equal(s.instalments[1].status, 'UPCOMING');
    assert.equal(s.principalCents, schedule.instalments[0].closingPrincipalCents);
    assert.equal(s.arrearsCents, 0);
    assert.equal(s.settledOn, null);
    assert.deepEqual(a.instalments, [{ seq: 1, amountCents: amt(1) }]);
  });

  it('paying every instalment on time settles the loan with a zero balance', () => {
    const payments = INST.map((i) => pay(i.dueDate, i.amountCents));
    const s = ledger(payments, due(4));
    assert.equal(s.totalCents, 0);
    assert.equal(s.settledOn, due(4));
    assert.ok(s.instalments.every((i) => i.status === 'PAID'));
    assert.equal(s.overpaymentCents, 0);
  });
});

describe('partial payments', () => {
  it('R 700 of a R 1 250 instalment: records the R 700, leaves R 550 and shows Partially Paid', () => {
    const s0 = buildSchedule({ ...TERMS, principalCents: 300_000, instalments: 3, serviceFeeCents: 6900 });
    const inst = s0.instalments.map((i) => ({ id: `x${i.seq}`, seq: i.seq, dueDate: i.dueDate, amountCents: 125_000, feeCents: i.feeCents, interestCents: i.interestCents, superseded: false }));
    const s = computeLedger({
      principalDebtCents: 300_000,
      disbursedOn: TERMS.startDate,
      instalments: inst,
      payments: [pay('2026-01-20', 70_000)],
      adjustments: [],
      asOf: '2026-01-20',
    });
    assert.equal(s.instalments[0].status, 'PARTIALLY_PAID');
    assert.equal(s.instalments[0].paidCents, 70_000);
    assert.equal(s.instalments[0].remainingCents, 55_000);
    assert.equal(s.totalPaidCents, 70_000);
  });

  it('becomes Overdue (part-paid) once the due date passes, with the remainder in arrears', () => {
    const s = ledger([pay(due(1), 70_000)], addDays(due(1), 3));
    const i1 = s.instalments[0];
    assert.equal(i1.status, 'OVERDUE');
    assert.equal(i1.paidCents, 70_000);
    assert.equal(i1.remainingCents, amt(1) - 70_000);
    assert.equal(i1.daysOverdue, 3);
    assert.equal(s.arrearsCents, amt(1) - 70_000);
  });

  it('multiple partial payments add up and complete the instalment', () => {
    const s = ledger([pay(addDays(due(1), -5), 40_000), pay(addDays(due(1), -1), 40_000), pay(due(1), amt(1) - 80_000)], due(1));
    assert.equal(s.instalments[0].status, 'PAID');
    assert.equal(s.instalments[0].fullyPaidOn, due(1));
    assert.equal(s.instalments[1].status, 'UPCOMING');
  });

  it('a partial payment is never shown as a full instalment payment', () => {
    const s = ledger([pay(due(1), amt(1) - 1)], due(1));
    assert.equal(s.instalments[0].status, 'PARTIALLY_PAID');
    assert.equal(s.instalments[0].remainingCents, 1);
  });
});

describe('missed and late payments', () => {
  it('a missed instalment is overdue with days counted from the due date', () => {
    const s = ledger([], addDays(due(1), 10));
    assert.equal(s.instalments[0].status, 'OVERDUE');
    assert.equal(s.instalments[0].daysOverdue, 10);
    assert.equal(s.oldestArrearsDate, due(1));
    assert.equal(s.arrearsCents, amt(1));
  });

  it('two missed instalments are both overdue and arrears is their total', () => {
    const s = ledger([], addDays(due(2), 1));
    assert.equal(s.instalments.filter((i) => i.status === 'OVERDUE').length, 2);
    assert.equal(s.arrearsCents, amt(1) + amt(2));
    assert.equal(s.daysInArrears, 1 + 31);
  });

  it('due today is DUE_TODAY, not overdue', () => {
    const s = ledger([], due(1));
    assert.equal(s.instalments[0].status, 'DUE_TODAY');
    assert.equal(s.arrearsCents, 0);
  });

  it('a payment recorded after its due date clears the arrears and the overdue status', () => {
    const late = addDays(due(1), 6);
    const s = ledger([pay(late, amt(1))], late);
    assert.equal(s.instalments[0].status, 'PAID');
    assert.equal(s.arrearsCents, 0);
    // Flat interest: paying late adds no interest, so the balance is exactly as if paid on time.
    assert.equal(s.principalCents, schedule.instalments[0].closingPrincipalCents);
    assert.equal(s.totalCents, ledger([pay(due(1), amt(1))], late).totalCents);
  });

  it('after the term ends, everything still owed is due and no further interest is added', () => {
    const payments = INST.slice(0, 3).map((i) => pay(addDays(i.dueDate, 10), i.amountCents));
    const s = ledger(payments, addDays(due(4), 60));
    assert.equal(s.instalments[3].status, 'OVERDUE');
    assert.equal(s.totalCents, amt(4));
    assert.equal(s.arrearsCents, s.totalCents);
    assert.equal(s.totalInterestChargedCents, 100_000);
  });
});

describe('backdated entries', () => {
  it('a backdated payment gives the same result as if it had been recorded on its date', () => {
    const onTime = ledger([pay(due(1), amt(1)), pay(due(2), amt(2))], due(2));
    // Same payments, but recorded in the reverse order (the first one captured late).
    const b = pay(due(2), amt(2));
    const a = pay(due(1), amt(1));
    const backdated = ledger([b, a], due(2));
    assert.equal(backdated.totalCents, onTime.totalCents);
    assert.deepEqual(
      backdated.instalments.map((i) => i.status),
      onTime.instalments.map((i) => i.status),
    );
  });

  it('a backdated payment changes the allocation of later payments (less interest still due)', () => {
    const later = pay(due(2), amt(2));
    const without = ledger([later], due(2));
    const withBackdated = ledger([later, pay(due(1), amt(1))], due(2));
    const laterAlloc = (s: typeof without) => s.allocations.find((x) => x.paymentId === later.id)!;
    assert.ok(laterAlloc(withBackdated).interestCents < laterAlloc(without).interestCents);
  });
});

describe('early repayment and settlement', () => {
  it('extra paid early reduces principal and covers the next instalment; interest stays flat', () => {
    const p = pay(due(1), amt(1) + 100_000);
    const s = ledger([p], due(1));
    assert.equal(s.allocations[0].overpaymentCents, 0);
    assert.equal(s.principalCents, schedule.instalments[0].closingPrincipalCents - 100_000);
    assert.equal(s.instalments[1].status, 'PARTIALLY_PAID');
    assert.equal(s.instalments[1].paidCents, 100_000);
    // Paying down principal doesn't reduce the next month's interest.
    const next = ledger([p], due(2), { fullTermInterest: false });
    assert.equal(next.totalInterestChargedCents, 50_000);
  });

  it("early settlement: principal + the whole term's interest + unpaid fees, no future fees", () => {
    const asOf = '2026-01-10';
    const quote = ledger([], asOf);
    assert.equal(quote.interestCents, 100_000);
    assert.equal(quote.futureInterestCents, 100_000);
    assert.equal(quote.feesCents, 0);
    assert.equal(quote.totalCents, 600_000);

    const s = ledger([pay(asOf, quote.totalCents)], asOf);
    assert.equal(s.totalCents, 0);
    assert.equal(s.settledOn, asOf);
    assert.ok(s.instalments.every((i) => i.status === 'PAID'));
    // Nothing more accrues after settlement.
    const later = ledger([pay(asOf, quote.totalCents)], due(4));
    assert.equal(later.totalCents, 0);
    assert.equal(later.totalFeesChargedCents, 0);
  });

  it('with full-term interest switched off, settling early pays only interest already due', () => {
    const p1 = pay(due(1), amt(1));
    const quote = ledger([p1], '2026-02-10', { fullTermInterest: false });
    assert.equal(quote.futureInterestCents, 0);
    assert.equal(quote.totalCents, 375_000); // 3 x R 1 250 principal; month 1 interest already paid
    const s = ledger([p1, pay('2026-02-10', quote.totalCents)], due(4), { fullTermInterest: false });
    assert.equal(s.totalCents, 0);
    assert.equal(s.settledOn, '2026-02-10');
    assert.equal(s.totalInterestChargedCents, 25_000);
  });

  it('paying ahead goes to principal first, then interest not yet due; settled once all is paid', () => {
    const s = ledger([pay(due(1), 500_000)], due(1));
    // R 1 569 due + R 3 431 ahead, all of it to principal (R 3 750 left after month 1).
    assert.equal(s.principalCents, 375_000 - (500_000 - amt(1)));
    assert.equal(s.futureInterestCents, 75_000);
    // On the next due date that month's service fee is added; settle with the figure for that day.
    const quote = ledger([pay(due(1), 500_000)], due(2));
    assert.equal(quote.totalCents, s.totalCents + 6900);
    const done = ledger([pay(due(1), 500_000), pay(due(2), quote.totalCents)], due(4));
    assert.equal(done.settledOn, due(2));
    assert.equal(done.totalInterestChargedCents, 100_000);
    assert.equal(done.totalFeesChargedCents, 6900 * 2);
  });

  it('full settlement after some instalments', () => {
    const p1 = pay(due(1), amt(1));
    const quote = ledger([p1], '2026-02-10');
    const s = ledger([p1, pay('2026-02-10', quote.totalCents)], '2026-02-10');
    assert.equal(s.totalCents, 0);
    assert.equal(s.settledOn, '2026-02-10');
  });
});

describe('overpayment', () => {
  it('never lets the balance go negative; the excess is held as overpayment', () => {
    const quote = ledger([], due(1));
    const s = ledger([pay(due(1), quote.totalCents + 12_345)], due(1));
    assert.equal(s.totalCents, 0);
    assert.equal(s.overpaymentCents, 12_345);
    assert.equal(s.allocations[0].overpaymentCents, 12_345);
    assert.equal(s.settledOn, due(1));
  });

  it('a payment after settlement is entirely overpayment', () => {
    const quote = ledger([], due(1));
    const s = ledger([pay(due(1), quote.totalCents), pay(due(2), 5000)], due(2));
    assert.equal(s.allocations[1].overpaymentCents, 5000);
    assert.equal(s.overpaymentCents, 5000);
  });

  it('a refund adjustment reduces the overpayment, but never below zero', () => {
    const quote = ledger([], due(1));
    const s = ledger([pay(due(1), quote.totalCents + 10_000)], due(2), {
      adjustments: [adj(due(2), 'OVERPAYMENT_REFUND', 50_000)],
    });
    assert.equal(s.overpaymentCents, 0);
    assert.equal(s.adjustments[0].appliedCents, 10_000);
  });
});

describe('reversals and corrections', () => {
  it('removing a reversed payment restores the arrears exactly', () => {
    const p = pay(due(1), amt(1));
    const asOf = addDays(due(1), 5);
    const withPayment = ledger([p], asOf);
    const reversed = ledger([], asOf); // the service excludes reversed payments
    assert.equal(withPayment.arrearsCents, 0);
    assert.equal(reversed.arrearsCents, amt(1));
    assert.equal(reversed.instalments[0].status, 'OVERDUE');
  });

  it('a correction (reverse + replacement) equals recording the right amount in the first place', () => {
    const asOf = due(1);
    const right = ledger([pay(asOf, 90_000)], asOf);
    const corrected = ledger([pay(asOf, 90_000)], asOf); // original 9 000 reversed, replacement 90 000
    assert.equal(corrected.totalCents, right.totalCents);
  });
});

describe('loan adjustments', () => {
  it('an interest waiver reduces interest owed and counts towards the instalment', () => {
    const asOf = addDays(due(1), 1);
    const opts = { fullTermInterest: false };
    const before = ledger([], asOf, opts);
    assert.equal(before.interestCents, 25_000);
    const s = ledger([], asOf, { ...opts, adjustments: [adj(asOf, 'INTEREST_WAIVER', 1_000_000)] });
    assert.equal(s.adjustments[0].appliedCents, 25_000);
    assert.equal(s.interestCents, 0);
    assert.equal(s.instalments[0].remainingCents, amt(1) - 25_000);
  });

  it('an interest waiver can discount interest not yet due (e.g. an early-settlement discount)', () => {
    const asOf = '2026-01-10';
    const waiver = adj(asOf, 'INTEREST_WAIVER', 60_000);
    const s = ledger([], asOf, { adjustments: [waiver] });
    assert.equal(s.adjustments[0].appliedCents, 60_000);
    assert.equal(s.totalCents, 540_000);
    // The waived interest is not charged again when those instalments fall due.
    assert.equal(ledger([], due(4), { adjustments: [waiver] }).totalCents, 627_600 - 60_000);
  });

  it('a fee charge adds to fees and to the next instalment due', () => {
    const s = ledger([], '2026-01-05', { adjustments: [adj('2026-01-05', 'FEE_CHARGE', 5000)] });
    assert.equal(s.feesCents, 5000);
    assert.equal(s.instalments[0].amountDueCents, amt(1) + 5000);
  });

  it('in duplum: unpaid interest + fees stop growing past the unpaid principal while in arrears', () => {
    // 30% a month for 4 months would be R 6 000 interest on R 5 000.
    const high = buildSchedule({ ...TERMS, monthlyRateBps: 3000 });
    const inst = high.instalments.map((i) => ({
      id: `h${i.seq}`,
      seq: i.seq,
      dueDate: i.dueDate,
      amountCents: i.amountCents,
      feeCents: i.feeCents,
      interestCents: i.interestCents,
      superseded: false,
    }));
    const s = ledger([], '2030-01-01', { instalments: inst });
    assert.ok(s.inDuplumCapped);
    assert.equal(s.interestCents + s.feesCents, s.principalCents);
    const uncapped = ledger([], '2030-01-01', { instalments: inst, inDuplum: false });
    assert.equal(uncapped.interestCents, 600_000);
  });
});

describe('repayment arrangements', () => {
  it('superseded instalments stop being collectable; the new schedule takes over', () => {
    const effective = addDays(due(1), 10);
    const before = ledger([], effective);
    assert.equal(before.instalments[0].status, 'OVERDUE');

    const newSchedule = buildSchedule({
      principalCents: before.principalCents,
      monthlyRateBps: TERMS.monthlyRateBps,
      startDate: effective,
      firstDueDate: '2026-03-01',
      instalments: 6,
      frequency: 'MONTHLY',
      serviceFeeCents: 6900,
      carriedChargesCents: before.interestCents - before.futureInterestCents + before.feesCents,
      // The old schedule's interest not yet due (instalments 2-4), moved to the new dates.
      fixedInterestCents: 75_000,
    });
    const instalments: EngineInstalment[] = [
      ...INST.map((i) => ({ ...i, superseded: true, supersededFrom: effective, amountCents: 0 })),
      ...newSchedule.instalments.map((i) => ({ id: `n${i.seq}`, seq: i.seq, dueDate: i.dueDate, amountCents: i.amountCents, feeCents: 6900, interestCents: i.interestCents, superseded: false })),
    ];
    const s = ledger([], effective, { instalments });
    assert.equal(s.arrearsCents, 0);
    assert.ok(s.instalments.filter((i) => i.seq <= 4 && i.id.startsWith('i')).every((i) => i.status === 'RESCHEDULED'));
    assert.equal(s.nextDue?.dueDate, '2026-03-01');
    // Rescheduling adds no interest: the total owed is unchanged by the arrangement itself.
    assert.equal(newSchedule.totalInterestCents, 75_000);
    assert.equal(s.totalCents, before.totalCents);
  });
});

describe('multiple loans for one client', () => {
  it('each loan is computed independently from its own transactions', () => {
    const loanA = ledger([pay(due(1), amt(1))], due(1));
    const loanB = ledger([], addDays(due(1), 2));
    assert.equal(loanA.arrearsCents, 0);
    assert.equal(loanB.arrearsCents, amt(1));
  });
});

describe('payment preview', () => {
  it('previews allocation and the balance after, without saving', () => {
    const input: EngineInput = {
      principalDebtCents: TERMS.principalCents,
      disbursedOn: TERMS.startDate,
      instalments: INST,
      payments: [],
      adjustments: [],
      asOf: due(1),
    };
    const { current, after, allocation } = previewPayment(input, { date: due(1), amountCents: 70_000 });
    assert.equal(allocation.amountCents, 70_000);
    assert.equal(after.totalCents, current.totalCents - 70_000);
    assert.equal(after.instalments[0].status, 'PARTIALLY_PAID');
  });
});
