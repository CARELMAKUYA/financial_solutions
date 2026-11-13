// Shapes returned by the API. Money is integer cents; `@db.Date` columns arrive as ISO strings
// ("2026-11-13T00:00:00.000Z"): use the first 10 characters as the calendar date.

export type Role = "OWNER" | "ADMIN";
export type ProductType = "SHORT_TERM" | "SALARY_ADVANCE" | "EMERGENCY_CASH";
export type Frequency = "MONTHLY" | "FORTNIGHTLY" | "WEEKLY";
export type LoanStatus = "ACTIVE" | "SETTLED" | "CANCELLED" | "WRITTEN_OFF";
export type InstalmentStatus = "UPCOMING" | "DUE_TODAY" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "RESCHEDULED";
export type CollectionStatus = "NONE" | "PROMISE_TO_PAY" | "CONFIRMED_MISSED";
export type PaymentMethod = "CASH" | "EFT" | "BANK_DEPOSIT";
export type PaymentStatus = "PENDING_VERIFICATION" | "CONFIRMED" | "REJECTED" | "REVERSED";
export type AllocationComponent = "INTEREST" | "FEES" | "PRINCIPAL" | "OVERPAYMENT";
export type LoanAdjustmentKind = "FEE_CHARGE" | "INTEREST_WAIVER" | "FEE_WAIVER" | "PRINCIPAL_WRITE_OFF" | "OVERPAYMENT_REFUND";
export type ApplicationStatus = "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN" | "ISSUED";
export type FollowUpOutcome = "NOTE" | "NO_ANSWER" | "SPOKE_TO_CLIENT" | "PROMISE_TO_PAY" | "PAYMENT_CLAIMED" | "CONFIRMED_MISSED";
export type DocumentKind = "CONTRACT" | "ID_DOCUMENT" | "PAYSLIP" | "BANK_STATEMENT" | "PROOF_OF_PAYMENT" | "OTHER";
export type NotificationType =
  | "DUE_SOON"
  | "DUE_TODAY"
  | "OVERDUE"
  | "DAILY_OVERDUE_SUMMARY"
  | "WEEKLY_COLLECTION_SUMMARY"
  | "OVERPAYMENT"
  | "VERIFICATION_NEEDED"
  | "LOAN_SETTLED";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  canAuthoriseCorrections: boolean;
}

export interface StaffUser extends User {
  active: boolean;
  receiveEmails: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Client {
  id: string;
  clientNumber: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  employer: string | null;
  employerPhone: string | null;
  monthlyIncomeCents: number | null;
  payday: number | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

export interface ClientListItem extends Client {
  loans: { id: string; totalOutstandingCents: number; arrearsCents: number }[];
}

export interface LoanApplication {
  id: string;
  applicationNumber: string;
  clientId: string;
  product: ProductType;
  requestedAmountCents: number;
  requestedInstalments: number;
  frequency: Frequency;
  purpose: string | null;
  monthlyIncomeCents: number | null;
  monthlyExpensesCents: number | null;
  status: ApplicationStatus;
  decisionNotes: string | null;
  decidedAt: string | null;
  createdAt: string;
  client?: Pick<Client, "id" | "firstName" | "lastName" | "clientNumber">;
  loan?: { id: string; reference: string } | null;
  /** Bank statement coverage for this application (null when statements aren't required). */
  statements?: StatementCheck | null;
}

/** Which months of bank statements are required and still missing (months are YYYY-MM). */
export interface StatementCheck {
  asOf: string;
  required: string[];
  missing: string[];
  complete: boolean;
}

export interface LoanDocument {
  id: string;
  clientId: string;
  loanId: string | null;
  paymentId: string | null;
  kind: DocumentKind;
  periodFrom: string | null;
  periodTo: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ClientDetail extends Client {
  loans: Loan[];
  applications: LoanApplication[];
  documents: LoanDocument[];
  /** What a new application today would need (null when statements aren't required). */
  statements: StatementCheck | null;
}

export interface Loan {
  id: string;
  reference: string;
  clientId: string;
  applicationId: string | null;
  product: ProductType;
  status: LoanStatus;
  frequency: Frequency;
  loanAmountCents: number;
  initiationFeeCents: number;
  principalDebtCents: number;
  annualRateBps: number;
  serviceFeeCents: number;
  numberOfInstalments: number;
  disbursedOn: string;
  firstDueDate: string;
  instalmentCents: number;
  scheduleVersion: number;
  notes: string | null;
  createdAt: string;
  principalOutstandingCents: number;
  interestOutstandingCents: number;
  feesOutstandingCents: number;
  totalOutstandingCents: number;
  arrearsCents: number;
  oldestArrearsDate: string | null;
  overpaymentCents: number;
  totalPaidCents: number;
  lastPaymentDate: string | null;
  nextDueDate: string | null;
  nextDueCents: number;
  pendingVerificationCents: number;
  inDuplumCapped: boolean;
  settledOn: string | null;
  client?: Pick<Client, "id" | "firstName" | "lastName" | "clientNumber" | "phone">;
}

export interface Instalment {
  id: string;
  loanId: string;
  version: number;
  seq: number;
  dueDate: string;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  supersededOn: string | null;
  supersededPaidCents: number | null;
  paidCents: number;
  remainingCents: number;
  amountDueCents: number;
  status: InstalmentStatus;
  fullyPaidOn: string | null;
  lastPaymentDate: string | null;
  collectionStatus: CollectionStatus;
  promiseDate: string | null;
}

export interface PaymentAllocation {
  id: string;
  component: AllocationComponent;
  amountCents: number;
  balanceAfterCents: number;
}

export interface PaymentAdjustment {
  id: string;
  kind: "REVERSAL" | "CORRECTION";
  reason: string;
  replacementPaymentId: string | null;
  authorisedById: string;
  createdAt: string;
}

export interface PaymentVerification {
  id: string;
  action: "FLAGGED" | "VERIFIED" | "REJECTED";
  notes: string | null;
  userId: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  transactionNumber: string;
  loanId: string;
  clientId: string;
  amountCents: number;
  paymentDate: string;
  recordedAt: string;
  recordedById: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  scheduledInstalmentCents: number;
  balanceBeforeCents: number;
  replacesPaymentId: string | null;
  overpaymentFlag: boolean;
  overpaymentResolvedAt: string | null;
  overpaymentResolution: string | null;
  allocations: PaymentAllocation[];
}

export interface LoanPayment extends Payment {
  adjustments: PaymentAdjustment[];
  verifications: PaymentVerification[];
  documents: { id: string; fileName: string; mimeType: string }[];
}

export interface LoanAdjustment {
  id: string;
  kind: LoanAdjustmentKind;
  amountCents: number;
  effectiveDate: string;
  reason: string;
  authorisedById: string;
  createdAt: string;
  reversedAt: string | null;
  reversedById: string | null;
  reversalReason: string | null;
}

export interface RepaymentArrangement {
  id: string;
  effectiveDate: string;
  previousVersion: number;
  newVersion: number;
  frequency: Frequency;
  numberOfInstalments: number;
  firstDueDate: string;
  instalmentCents: number;
  balanceAtArrangementCents: number;
  reason: string;
  authorisedById: string;
  createdAt: string;
}

export interface FollowUpNote {
  id: string;
  loanId: string;
  instalmentId: string | null;
  outcome: FollowUpOutcome;
  note: string;
  promiseDate: string | null;
  createdById: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string } | null;
}

export interface LoanDetail extends Loan {
  client: Client;
  application: { id: string; applicationNumber: string } | null;
  instalments: Instalment[];
  payments: LoanPayment[];
  adjustments: LoanAdjustment[];
  arrangements: RepaymentArrangement[];
  followUps: FollowUpNote[];
  documents: LoanDocument[];
  userNames: Record<string, string>;
  /** Instalments each confirmed payment went towards, keyed by payment id. */
  coverage: Record<string, { seq: number; amountCents: number }[]>;
  settlementQuote: { asOf: string; principalCents: number; interestCents: number; feesCents: number; totalCents: number };
  daysInArrears: number;
  audit: AuditEntry[];
}

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  closingPrincipalCents: number;
}

export interface Quote {
  loanAmountCents: number;
  initiationFeeCents: number;
  principalDebtCents: number;
  instalments: ScheduleRow[];
  instalmentCents: number;
  totalInterestCents: number;
  totalFeesCents: number;
  totalRepayableCents: number;
  totalCostOfCreditCents: number;
}

export interface PaymentPreview {
  clientName: string;
  loanReference: string;
  currentBalanceCents: number;
  scheduledInstalmentCents: number;
  arrearsCents: number;
  allocation: {
    interestCents: number;
    feesCents: number;
    principalCents: number;
    overpaymentCents: number;
    instalments: { seq: number; amountCents: number }[];
  };
  balanceAfterCents: number;
  arrearsAfterCents: number;
  settles: boolean;
  needsVerification: boolean;
  duplicates: { id: string; transactionNumber: string; amountCents: number; paymentDate: string; method: PaymentMethod; reference: string | null; recordedAt: string; status: PaymentStatus }[];
  warnings: string[];
}

export interface PaymentListItem extends Payment {
  loan: { id: string; reference: string; client: { id: string; firstName: string; lastName: string } };
  recordedByName: string;
}

export interface OverdueRow {
  instalmentId: string;
  seq: number;
  version: number;
  dueDate: string;
  amountDueCents: number;
  paidCents: number;
  remainingCents: number;
  daysOverdue: number;
  collectionStatus: CollectionStatus;
  recordingStatus: "NOT_RECORDED" | "PROMISE_TO_PAY" | "CONFIRMED_MISSED" | "AWAITING_VERIFICATION";
  promiseDate: string | null;
  loan: {
    id: string;
    reference: string;
    lastPaymentDate: string | null;
    arrearsCents: number;
    totalOutstandingCents: number;
    pendingVerificationCents: number;
    client: { id: string; firstName: string; lastName: string; phone: string; altPhone: string | null; email: string | null };
  };
  followUps: FollowUpNote[];
}

export interface CalendarEvent {
  instalmentId: string;
  loanId: string;
  loanReference: string;
  clientName: string;
  seq: number;
  dueDate: string;
  amountDueCents: number;
  paidCents: number;
  remainingCents: number;
  status: InstalmentStatus;
}

export interface Dashboard {
  today: string;
  activeLoans: number;
  totalOutstandingCents: number;
  principalOutstandingCents: number;
  arrearsCents: number;
  loansInArrears: number;
  collectedTodayCents: number;
  collectedTodayCount: number;
  collectedMonthCents: number;
  collectedMonthCount: number;
  dueTodayCents: number;
  dueTodayCount: number;
  dueWeekCents: number;
  dueWeekCount: number;
  pendingVerificationCents: number;
  pendingVerificationCount: number;
  overpaymentsToReview: number;
  settledThisMonth: number;
  openApplications: number;
  unreadNotifications: number;
  aging: { bucket: string; loans: number; arrearsCents: number }[];
  recentPayments: (Payment & { loan: { id: string; reference: string; client: { firstName: string; lastName: string } } })[];
}

export interface CollectionsReport {
  from: string;
  to: string;
  totalCents: number;
  count: number;
  components: Record<AllocationComponent, number>;
  byMethod: Partial<Record<PaymentMethod, { count: number; cents: number }>>;
  byDay: { date: string; cents: number }[];
  byAdmin: { name: string; count: number; cents: number }[];
  dueInPeriodCents: number;
  paidTowardsDueCents: number;
  payments: {
    id: string;
    transactionNumber: string;
    paymentDate: string;
    loanReference: string;
    clientName: string;
    method: PaymentMethod;
    reference: string | null;
    amountCents: number;
    recordedBy: string;
    interestCents: number;
    feesCents: number;
    principalCents: number;
    overpaymentCents: number;
  }[];
}

export interface PortfolioRow {
  id: string;
  reference: string;
  clientName: string;
  clientNumber: string;
  product: ProductType;
  disbursedOn: string;
  loanAmountCents: number;
  principalOutstandingCents: number;
  interestOutstandingCents: number;
  feesOutstandingCents: number;
  totalOutstandingCents: number;
  arrearsCents: number;
  daysInArrears: number;
  nextDueDate: string | null;
  nextDueCents: number;
  totalPaidCents: number;
}

export interface ReconciliationEntry {
  id: string;
  date: string;
  method: PaymentMethod;
  recordedCents: number;
  actualCents: number;
  varianceCents: number;
  notes: string | null;
  createdAt: string;
  reconciledBy: string;
}

export interface ReconciliationDay {
  date: string;
  backdatedRecordedToday: number;
  methods: {
    method: PaymentMethod;
    confirmedCents: number;
    pendingCents: number;
    count: number;
    latest: ReconciliationEntry | null;
    history: ReconciliationEntry[];
  }[];
  payments: (Payment & { loan: { id: string; reference: string; client: { firstName: string; lastName: string } }; recordedByName: string; hasProof: boolean })[];
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  loanId: string | null;
  instalmentId: string | null;
  createdAt: string;
  readAt: string | null;
  emailStatus: "NOT_SENT" | "PENDING" | "SENT" | "FAILED";
  emailError: string | null;
  loan: { id: string; reference: string } | null;
}

export interface Settings {
  companyName: string;
  tagline: string;
  ncrRegistrationNumber: string;
  address: string;
  phone: string;
  email: string;
  bankDetails: string;
  allocationOrder: ("INTEREST" | "FEES" | "PRINCIPAL")[];
  inDuplum: boolean;
  verifyMethods: PaymentMethod[];
  defaultAnnualRateBps: number;
  defaultServiceFeeCents: number;
  defaultInitiationFeeCents: number;
  requiredStatementMonths: number;
  reminderDaysBefore: number;
  remindDueSoon: boolean;
  remindDueToday: boolean;
  remindDayAfter: boolean;
  overdueRepeatDays: number;
  dailySummary: boolean;
  weeklySummary: boolean;
  reminderHour: number;
  emailEnabled: boolean;
  smtpConfigured: boolean;
}
