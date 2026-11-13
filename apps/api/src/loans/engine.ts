/**
 * The loan ledger engine. Pure functions, no Nest/Prisma, so every rule is unit tested.
 *
 * A loan's state is never edited directly. It is derived by replaying, in date order, the
 * loan terms plus every confirmed payment and authorised adjustment. Backdated payments,
 * reversals and corrections therefore always produce the same result as if they had been
 * recorded on time, and history is never overwritten.
 *
 * Money is integer cents throughout. Interest is simple daily interest on the outstanding
 * principal debt: principal × annual rate × days / 365, rounded to the cent (half up) each
 * time it is brought to account (at every due date, payment and adjustment).
 *
 * Payments are credited on their actual payment date in the configured order. The default is
 * the National Credit Act s126(3) order: due or unpaid interest, then fees and charges, then
 * principal. Anything beyond the full settlement amount is held as an overpayment credit and
 * flagged for review; the balance never goes negative.
 */
import { addDays, addMonths, DateOnly, diffDays } from '../common/dates';

export type Component = 'INTEREST' | 'FEES' | 'PRINCIPAL';
export const DEFAULT_ALLOCATION_ORDER: Component[] = ['INTEREST', 'FEES', 'PRINCIPAL'];

export type Frequency = 'MONTHLY' | 'FORTNIGHTLY' | 'WEEKLY';

export type AdjustmentKind = 'FEE_CHARGE' | 'INTEREST_WAIVER' | 'FEE_WAIVER' | 'PRINCIPAL_WRITE_OFF' | 'OVERPAYMENT_REFUND';

export type InstalmentStatus = 'UPCOMING' | 'DUE_TODAY' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'RESCHEDULED';

const DAY_BASIS = 365;

/** Interest in cents on `principal` for `days` days at `annualRateBps` (basis points, 2750 = 27.5% p.a.). */
export function interestFor(principalCents: number, annualRateBps: number, days: number): number {
  if (principalCents <= 0 || days <= 0 || annualRateBps <= 0) return 0;
  // principal (≤ 1e9) × bps (≤ 1e5) × days (≤ 1e4) stays well inside Number's exact-integer range.
  return roundHalfUp((principalCents * annualRateBps * days) / (10_000 * DAY_BASIS));
}

export function roundHalfUp(x: number): number {
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

export function dueDates(firstDueDate: DateOnly, count: number, frequency: Frequency): DateOnly[] {
  const anchorDay = Number(firstDueDate.slice(8, 10));
  return Array.from({ length: count }, (_, i) =>
    frequency === 'MONTHLY' ? addMonths(firstDueDate, i, anchorDay) : addDays(firstDueDate, i * (frequency === 'WEEKLY' ? 7 : 14)),
  );
}

export interface ScheduleInput {
  /** Opening principal debt (cash advanced + any capitalised initiation fee). */
  principalCents: number;
  annualRateBps: number;
  /** Interest accrues from this date (disbursement, or the arrangement's effective date). */
  startDate: DateOnly;
  firstDueDate: DateOnly;
  instalments: number;
  frequency: Frequency;
  /** Service fee charged on each due date. */
  serviceFeeCents: number;
  /** Interest/fees already due at `startDate` (rescheduling only); spread evenly over the new instalments. */
  carriedChargesCents?: number;
}

export interface ScheduledInstalment {
  seq: number;
  dueDate: DateOnly;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  /** Projected principal debt after this instalment is paid on time. */
  closingPrincipalCents: number;
}

export interface Schedule {
  instalments: ScheduledInstalment[];
  /** The regular instalment (the last one may differ by a few cents). */
  instalmentCents: number;
  totalInterestCents: number;
  totalFeesCents: number;
  totalRepayableCents: number;
}

/**
 * Level-instalment schedule on actual day counts. Finds the smallest whole-cent principal+interest
 * payment that clears the debt when every instalment is paid on its due date, then trims the last
 * instalment so the projected balance lands exactly on zero.
 */
export function buildSchedule(input: ScheduleInput): Schedule {
  const { principalCents, annualRateBps, startDate, frequency, serviceFeeCents } = input;
  if (!Number.isInteger(principalCents) || principalCents <= 0) throw new Error('Principal must be a positive amount in cents');
  if (!Number.isInteger(input.instalments) || input.instalments < 1 || input.instalments > 120) throw new Error('Number of instalments must be between 1 and 120');
  if (input.firstDueDate <= startDate) throw new Error('The first due date must be after the start date');

  const dates = dueDates(input.firstDueDate, input.instalments, frequency);
  const days = dates.map((d, i) => diffDays(i === 0 ? startDate : dates[i - 1], d));
  const carried = input.carriedChargesCents ?? 0;
  const carriedShare = (i: number) => Math.floor(carried / dates.length) + (i < carried % dates.length ? 1 : 0);

  const simulate = (payment: number) => {
    let bal = principalCents;
    const rows: { interest: number; principal: number }[] = [];
    for (const d of days) {
      const interest = interestFor(bal, annualRateBps, d);
      const principal = payment - interest;
      bal -= principal;
      rows.push({ interest, principal });
    }
    return { bal, rows };
  };

  let lo = 0;
  let hi = principalCents * 3 + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (simulate(mid).bal <= 0) hi = mid;
    else lo = mid + 1;
  }
  const pi = lo;
  const { bal, rows } = simulate(pi);
  // bal ≤ 0: the last payment is too large by -bal.
  rows[rows.length - 1].principal += bal;

  let closing = principalCents;
  const instalments = rows.map((r, i) => {
    closing -= r.principal;
    const feeCents = serviceFeeCents + carriedShare(i);
    return {
      seq: i + 1,
      dueDate: dates[i],
      principalCents: r.principal,
      interestCents: r.interest,
      feeCents,
      amountCents: r.principal + r.interest + feeCents,
      closingPrincipalCents: closing,
    };
  });
  const totalInterestCents = instalments.reduce((s, x) => s + x.interestCents, 0);
  const totalFeesCents = instalments.reduce((s, x) => s + x.feeCents, 0);
  return {
    instalments,
    instalmentCents: instalments[0].amountCents,
    totalInterestCents,
    totalFeesCents,
    totalRepayableCents: principalCents + totalInterestCents + totalFeesCents,
  };
}

// ---------------------------------------------------------------------------
// Ledger replay
// ---------------------------------------------------------------------------

export interface EngineInstalment {
  id: string;
  seq: number;
  dueDate: DateOnly;
  /** Amount this instalment asks for (for a superseded instalment: what had been paid towards it). */
  amountCents: number;
  /** Service fee charged when this instalment falls due. */
  feeCents: number;
  /** Superseded by a repayment arrangement: still listed for history but no longer collectable. */
  superseded: boolean;
  /** For superseded instalments: the arrangement's effective date. Fees are charged only for due dates before it. */
  supersededFrom?: DateOnly;
}

export interface EnginePayment {
  id: string;
  date: DateOnly;
  amountCents: number;
  /** Tie-breaker for payments on the same day (ISO timestamp of recording). */
  order: string;
}

export interface EngineAdjustment {
  id: string;
  date: DateOnly;
  kind: AdjustmentKind;
  amountCents: number;
  order: string;
}

export interface EngineInput {
  principalDebtCents: number;
  annualRateBps: number;
  disbursedOn: DateOnly;
  instalments: EngineInstalment[];
  payments: EnginePayment[];
  adjustments: EngineAdjustment[];
  allocationOrder?: Component[];
  /** Cap unpaid interest+fees charged while in arrears at the unpaid principal (NCA s103(5) "in duplum"). */
  inDuplum?: boolean;
  /** Today. Interest is accrued up to here for the settlement figure. */
  asOf: DateOnly;
}

export interface PaymentAllocation {
  paymentId: string;
  date: DateOnly;
  amountCents: number;
  interestCents: number;
  feesCents: number;
  principalCents: number;
  overpaymentCents: number;
  /** Total legally payable immediately after this payment (interest accrued to the payment date). */
  balanceAfterCents: number;
  /** Instalments this payment went towards, by seq. */
  instalments: { seq: number; amountCents: number }[];
}

export interface AdjustmentResult {
  adjustmentId: string;
  /** Amount actually applied (a waiver can't exceed what's owed; a refund can't exceed the credit). */
  appliedCents: number;
}

export interface InstalmentState {
  id: string;
  seq: number;
  dueDate: DateOnly;
  scheduledCents: number;
  /** Amount due after end-of-term top-up and fee charges. */
  amountDueCents: number;
  paidCents: number;
  remainingCents: number;
  status: InstalmentStatus;
  fullyPaidOn: DateOnly | null;
  lastPaymentDate: DateOnly | null;
  daysOverdue: number;
}

export interface LedgerState {
  principalCents: number;
  /** Interest brought to account and unpaid, plus interest accrued from then to `asOf`. */
  interestCents: number;
  feesCents: number;
  /** Settlement amount today. Never negative. */
  totalCents: number;
  overpaymentCents: number;
  settledOn: DateOnly | null;
  totalPaidCents: number;
  totalInterestChargedCents: number;
  totalFeesChargedCents: number;
  inDuplumCapped: boolean;
  arrearsCents: number;
  oldestArrearsDate: DateOnly | null;
  daysInArrears: number;
  lastPaymentDate: DateOnly | null;
  nextDue: { seq: number; dueDate: DateOnly; amountCents: number } | null;
  allocations: PaymentAllocation[];
  adjustments: AdjustmentResult[];
  instalments: InstalmentState[];
}

type Event =
  | { type: 'DUE'; date: DateOnly; rank: 0; order: string; feeCents: number }
  | { type: 'ADJ'; date: DateOnly; rank: 1 | 3; order: string; adj: EngineAdjustment }
  | { type: 'PAY'; date: DateOnly; rank: 2; order: string; pay: EnginePayment };

export function computeLedger(input: EngineInput): LedgerState {
  const order = input.allocationOrder ?? DEFAULT_ALLOCATION_ORDER;
  const { annualRateBps, asOf } = input;

  const active = input.instalments.filter((i) => !i.superseded).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq);
  // Due dates that charge a service fee: every active instalment, plus superseded ones that fell due before the arrangement.
  const feeDates = input.instalments.filter((i) => !i.superseded || (i.supersededFrom && i.dueDate < i.supersededFrom));

  const events: Event[] = [
    ...feeDates.map((i) => ({ type: 'DUE' as const, date: i.dueDate, rank: 0 as const, order: String(i.seq).padStart(4, '0'), feeCents: i.feeCents })),
    ...input.adjustments.map((a) => ({
      type: 'ADJ' as const,
      date: a.date,
      // Charges and waivers apply before same-day payments; refunds after them.
      rank: (a.kind === 'OVERPAYMENT_REFUND' ? 3 : 1) as 1 | 3,
      order: a.order,
      adj: a,
    })),
    ...input.payments.map((p) => ({ type: 'PAY' as const, date: p.date, rank: 2 as const, order: p.order, pay: p })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.order.localeCompare(b.order));

  // Scheduled amounts, used for arrears (in duplum) during replay.
  const schedule = [...input.instalments]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq)
    .map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents }));

  let principal = input.principalDebtCents;
  let interest = 0;
  let fees = 0;
  let credit = 0;
  let lastAccrual = input.disbursedOn;
  let settledOn: DateOnly | null = null;
  let paidTowardsDebt = 0;
  let totalPaid = 0;
  let totalInterestCharged = 0;
  let totalFeesCharged = 0;
  let inDuplumCapped = false;
  let lastPaymentDate: DateOnly | null = null;
  const allocations: PaymentAllocation[] = [];
  const adjustments: AdjustmentResult[] = [];
  // Amounts that count towards instalments, in date order: payments (debt part) and waivers.
  const coverage: { date: DateOnly; amountCents: number; paymentIndex: number | null }[] = [];
  // Manual fee charges raise the next instalment's amount.
  const extraCharges: { date: DateOnly; amountCents: number }[] = [];

  const owed = () => principal + interest + fees;

  const inArrears = (date: DateOnly) => {
    const dueBefore = schedule.filter((s) => s.dueDate < date).reduce((s, x) => s + x.amountCents, 0);
    return dueBefore > paidTowardsDebt;
  };

  /** Adds interest/fees, applying the in duplum cap while in arrears. Returns the amount actually added. */
  const charge = (kind: 'INTEREST' | 'FEES', amount: number, date: DateOnly) => {
    if (amount <= 0) return 0;
    let add = amount;
    if (input.inDuplum && inArrears(date)) {
      const room = Math.max(0, principal - interest - fees);
      if (add > room) {
        add = room;
        inDuplumCapped = true;
      }
    }
    if (kind === 'INTEREST') {
      interest += add;
      totalInterestCharged += add;
    } else {
      fees += add;
      totalFeesCharged += add;
    }
    return add;
  };

  const accrueTo = (date: DateOnly) => {
    if (date > lastAccrual) {
      charge('INTEREST', interestFor(principal, annualRateBps, diffDays(lastAccrual, date)), date);
      lastAccrual = date;
    }
  };

  /** A new charge after the loan was settled: use any credit first, then the loan is open again. */
  const reopenIfCharged = (date: DateOnly) => {
    if (owed() > 0 && credit > 0) {
      const use = Math.min(credit, owed());
      credit -= use;
      applyToDebt(use);
      paidTowardsDebt += use;
      coverage.push({ date, amountCents: use, paymentIndex: null });
    }
    if (owed() > 0) settledOn = null;
  };

  const applyToDebt = (amount: number) => {
    const split = { INTEREST: 0, FEES: 0, PRINCIPAL: 0 };
    let left = amount;
    for (const c of order) {
      const bucket = c === 'INTEREST' ? interest : c === 'FEES' ? fees : principal;
      const take = Math.min(left, bucket);
      if (c === 'INTEREST') interest -= take;
      else if (c === 'FEES') fees -= take;
      else principal -= take;
      split[c] += take;
      left -= take;
    }
    return split;
  };

  for (const ev of events) {
    // Future due dates bring nothing to account yet; the API never accepts future-dated payments.
    if (ev.date > asOf) break;
    const settledBefore = settledOn !== null;

    if (ev.type === 'DUE') {
      if (settledBefore) continue; // Loan settled: no further interest or fees.
      accrueTo(ev.date);
      charge('FEES', ev.feeCents, ev.date);
      continue;
    }

    if (ev.type === 'ADJ') {
      const a = ev.adj;
      if (!settledBefore) accrueTo(ev.date);
      else lastAccrual = ev.date > lastAccrual ? ev.date : lastAccrual;
      let applied = 0;
      switch (a.kind) {
        case 'FEE_CHARGE':
          applied = charge('FEES', a.amountCents, ev.date);
          if (applied > 0) extraCharges.push({ date: ev.date, amountCents: applied });
          reopenIfCharged(ev.date);
          break;
        case 'INTEREST_WAIVER':
          applied = Math.min(a.amountCents, interest);
          interest -= applied;
          break;
        case 'FEE_WAIVER':
          applied = Math.min(a.amountCents, fees);
          fees -= applied;
          break;
        case 'PRINCIPAL_WRITE_OFF':
          applied = Math.min(a.amountCents, principal);
          principal -= applied;
          break;
        case 'OVERPAYMENT_REFUND':
          applied = Math.min(a.amountCents, credit);
          credit -= applied;
          break;
      }
      if (a.kind !== 'FEE_CHARGE' && a.kind !== 'OVERPAYMENT_REFUND' && applied > 0) {
        paidTowardsDebt += applied;
        coverage.push({ date: ev.date, amountCents: applied, paymentIndex: null });
      }
      adjustments.push({ adjustmentId: a.id, appliedCents: applied });
      if (settledOn === null && owed() === 0) settledOn = ev.date;
      continue;
    }

    // Payment
    const p = ev.pay;
    if (!settledBefore) accrueTo(ev.date);
    totalPaid += p.amountCents;
    if (lastPaymentDate === null || ev.date > (lastPaymentDate as DateOnly)) lastPaymentDate = ev.date;
    const toDebt = Math.min(p.amountCents, owed());
    const split = applyToDebt(toDebt);
    const over = p.amountCents - toDebt;
    credit += over;
    paidTowardsDebt += toDebt;
    allocations.push({
      paymentId: p.id,
      date: ev.date,
      amountCents: p.amountCents,
      interestCents: split.INTEREST,
      feesCents: split.FEES,
      principalCents: split.PRINCIPAL,
      overpaymentCents: over,
      balanceAfterCents: owed(),
      instalments: [],
    });
    if (toDebt > 0) coverage.push({ date: ev.date, amountCents: toDebt, paymentIndex: allocations.length - 1 });
    if (settledOn === null && owed() === 0) settledOn = ev.date;
  }

  // Interest accrued since the last event, up to today, is part of the settlement amount.
  let accrued = 0;
  if (settledOn === null && asOf > lastAccrual) {
    accrued = interestFor(principal, annualRateBps, diffDays(lastAccrual, asOf));
    if (input.inDuplum && inArrears(asOf)) {
      const room = Math.max(0, principal - interest - fees);
      if (accrued > room) {
        accrued = room;
        inDuplumCapped = true;
      }
    }
  }
  const interestNow = interest + accrued;
  const total = principal + interestNow + fees;

  // ---- Instalment statuses (first-in, first-out against the active schedule) ----
  const amounts = active.map((i) => i.amountCents);
  for (const c of extraCharges) {
    const idx = active.findIndex((i) => i.dueDate >= c.date);
    amounts[idx === -1 ? amounts.length - 1 : idx] += c.amountCents;
  }
  // Superseded instalments count only for what had been paid towards them.
  const superseded = input.instalments
    .filter((i) => i.superseded && i.amountCents > 0)
    .map((i) => ({ i, amount: i.amountCents }));
  const queue = [
    ...superseded.map((s) => ({ inst: s.i, amount: s.amount, idx: -1 })),
    ...active.map((inst, idx) => ({ inst, amount: amounts[idx], idx })),
  ].sort((a, b) => a.inst.dueDate.localeCompare(b.inst.dueDate) || a.inst.seq - b.inst.seq);

  // After the term ends, everything still owed is due on the last instalment.
  if (active.length && asOf >= active[active.length - 1].dueDate && settledOn === null) {
    const scheduledLeft = queue.reduce((s, q) => s + q.amount, 0) - paidTowardsDebt;
    if (total > scheduledLeft) {
      const last = queue.find((q) => q.idx === active.length - 1)!;
      last.amount += total - scheduledLeft;
    }
  }

  const paid = new Map<string, { paid: number; fullyPaidOn: DateOnly | null; last: DateOnly | null }>();
  let qi = 0;
  for (const c of coverage) {
    let left = c.amountCents;
    while (left > 0 && qi < queue.length) {
      const q = queue[qi];
      const st = paid.get(q.inst.id) ?? { paid: 0, fullyPaidOn: null, last: null };
      const take = Math.min(left, q.amount - st.paid);
      if (take > 0) {
        st.paid += take;
        st.last = c.date;
        left -= take;
        if (c.paymentIndex !== null) allocations[c.paymentIndex].instalments.push({ seq: q.inst.seq, amountCents: take });
      }
      if (st.paid >= q.amount) {
        st.fullyPaidOn = c.date;
        qi++;
      }
      paid.set(q.inst.id, st);
    }
    // Anything left over is a prepayment beyond the schedule (or an overpayment); not tied to an instalment.
  }

  const instalments: InstalmentState[] = [...input.instalments]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq)
    .map((inst) => {
      const q = queue.find((x) => x.inst.id === inst.id);
      const st = paid.get(inst.id) ?? { paid: 0, fullyPaidOn: null, last: null };
      const amountDue = q?.amount ?? 0;
      if (inst.superseded) {
        return {
          id: inst.id,
          seq: inst.seq,
          dueDate: inst.dueDate,
          scheduledCents: inst.amountCents,
          amountDueCents: amountDue,
          paidCents: st.paid,
          remainingCents: 0,
          status: 'RESCHEDULED' as const,
          fullyPaidOn: st.fullyPaidOn,
          lastPaymentDate: st.last,
          daysOverdue: 0,
        };
      }
      let remaining = Math.max(0, amountDue - st.paid);
      let status: InstalmentStatus;
      let fullyPaidOn = st.fullyPaidOn;
      if (remaining === 0 || settledOn !== null) {
        status = 'PAID';
        if (remaining > 0) fullyPaidOn = settledOn; // Settled early: covered by the settlement.
        remaining = 0;
      } else if (inst.dueDate > asOf) status = st.paid > 0 ? 'PARTIALLY_PAID' : 'UPCOMING';
      else if (inst.dueDate === asOf) status = st.paid > 0 ? 'PARTIALLY_PAID' : 'DUE_TODAY';
      else status = 'OVERDUE';
      return {
        id: inst.id,
        seq: inst.seq,
        dueDate: inst.dueDate,
        scheduledCents: inst.amountCents,
        amountDueCents: amountDue,
        paidCents: Math.min(st.paid, amountDue),
        remainingCents: remaining,
        status,
        fullyPaidOn,
        lastPaymentDate: st.last,
        daysOverdue: status === 'OVERDUE' ? diffDays(inst.dueDate, asOf) : 0,
      };
    });

  const overdue = instalments.filter((i) => i.status === 'OVERDUE');
  const arrears = Math.min(
    total,
    overdue.reduce((s, i) => s + i.remainingCents, 0),
  );
  const oldest = overdue[0]?.dueDate ?? null;
  const next = instalments.find((i) => i.status !== 'PAID' && i.status !== 'RESCHEDULED' && i.dueDate >= asOf) ?? null;

  return {
    principalCents: principal,
    interestCents: interestNow,
    feesCents: fees,
    totalCents: total,
    overpaymentCents: credit,
    settledOn,
    totalPaidCents: totalPaid,
    totalInterestChargedCents: totalInterestCharged + accrued,
    totalFeesChargedCents: totalFeesCharged,
    inDuplumCapped,
    arrearsCents: arrears,
    oldestArrearsDate: oldest,
    daysInArrears: oldest ? diffDays(oldest, asOf) : 0,
    lastPaymentDate,
    nextDue: next ? { seq: next.seq, dueDate: next.dueDate, amountCents: next.remainingCents } : null,
    allocations,
    adjustments,
    instalments,
  };
}

/**
 * What a payment of `amountCents` on `date` would do, without saving anything.
 * Used for the confirmation screen; the same function decides the saved result.
 */
export function previewPayment(input: EngineInput, payment: Omit<EnginePayment, 'id' | 'order'>) {
  const current = computeLedger(input);
  const after = computeLedger({
    ...input,
    payments: [...input.payments, { id: '__preview__', date: payment.date, amountCents: payment.amountCents, order: '￿' }],
  });
  const allocation = after.allocations.find((a) => a.paymentId === '__preview__')!;
  return { current, after, allocation };
}
