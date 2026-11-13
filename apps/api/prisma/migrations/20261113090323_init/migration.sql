-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SHORT_TERM', 'SALARY_ADVANCE', 'EMERGENCY_CASH');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('MONTHLY', 'FORTNIGHTLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'ISSUED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'SETTLED', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('UPCOMING', 'DUE_TODAY', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('NONE', 'PROMISE_TO_PAY', 'CONFIRMED_MISSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'EFT', 'BANK_DEPOSIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AllocationComponent" AS ENUM ('INTEREST', 'FEES', 'PRINCIPAL', 'OVERPAYMENT');

-- CreateEnum
CREATE TYPE "PaymentAdjustmentKind" AS ENUM ('REVERSAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "LoanAdjustmentKind" AS ENUM ('FEE_CHARGE', 'INTEREST_WAIVER', 'FEE_WAIVER', 'PRINCIPAL_WRITE_OFF', 'OVERPAYMENT_REFUND');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('FLAGGED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FollowUpOutcome" AS ENUM ('NOTE', 'NO_ANSWER', 'SPOKE_TO_CLIENT', 'PROMISE_TO_PAY', 'PAYMENT_CLAIMED', 'CONFIRMED_MISSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'DAILY_OVERDUE_SUMMARY', 'WEEKLY_COLLECTION_SUMMARY', 'OVERPAYMENT', 'VERIFICATION_NEEDED', 'LOAN_SETTLED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NOT_SENT', 'PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONTRACT', 'ID_DOCUMENT', 'PAYSLIP', 'BANK_STATEMENT', 'PROOF_OF_PAYMENT', 'OTHER');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "canAuthoriseCorrections" BOOLEAN NOT NULL DEFAULT false,
    "receiveEmails" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT NOT NULL DEFAULT 'Tee Que Financial Solutions',
    "tagline" TEXT NOT NULL DEFAULT 'Your Trusted Financial Partner',
    "ncrRegistrationNumber" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "bankDetails" TEXT NOT NULL DEFAULT '',
    "allocationOrder" TEXT[] DEFAULT ARRAY['INTEREST', 'FEES', 'PRINCIPAL']::TEXT[],
    "inDuplum" BOOLEAN NOT NULL DEFAULT true,
    "verifyMethods" "PaymentMethod"[] DEFAULT ARRAY[]::"PaymentMethod"[],
    "defaultAnnualRateBps" INTEGER NOT NULL DEFAULT 6000,
    "defaultServiceFeeCents" INTEGER NOT NULL DEFAULT 6900,
    "defaultInitiationFeeCents" INTEGER NOT NULL DEFAULT 0,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "remindDueSoon" BOOLEAN NOT NULL DEFAULT true,
    "remindDueToday" BOOLEAN NOT NULL DEFAULT true,
    "remindDayAfter" BOOLEAN NOT NULL DEFAULT true,
    "overdueRepeatDays" INTEGER NOT NULL DEFAULT 7,
    "dailySummary" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummary" BOOLEAN NOT NULL DEFAULT true,
    "reminderHour" INTEGER NOT NULL DEFAULT 7,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "clientNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "idNumber" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "employer" TEXT,
    "employerPhone" TEXT,
    "monthlyIncomeCents" INTEGER,
    "payday" INTEGER,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" UUID NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "product" "ProductType" NOT NULL DEFAULT 'SHORT_TERM',
    "requestedAmountCents" INTEGER NOT NULL,
    "requestedInstalments" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "purpose" TEXT,
    "monthlyIncomeCents" INTEGER,
    "monthlyExpensesCents" INTEGER,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNotes" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "applicationId" UUID,
    "product" "ProductType" NOT NULL DEFAULT 'SHORT_TERM',
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "frequency" "Frequency" NOT NULL,
    "loanAmountCents" INTEGER NOT NULL,
    "initiationFeeCents" INTEGER NOT NULL,
    "principalDebtCents" INTEGER NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL,
    "numberOfInstalments" INTEGER NOT NULL,
    "disbursedOn" DATE NOT NULL,
    "firstDueDate" DATE NOT NULL,
    "instalmentCents" INTEGER NOT NULL,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "principalOutstandingCents" INTEGER NOT NULL DEFAULT 0,
    "interestOutstandingCents" INTEGER NOT NULL DEFAULT 0,
    "feesOutstandingCents" INTEGER NOT NULL DEFAULT 0,
    "totalOutstandingCents" INTEGER NOT NULL DEFAULT 0,
    "arrearsCents" INTEGER NOT NULL DEFAULT 0,
    "oldestArrearsDate" DATE,
    "overpaymentCents" INTEGER NOT NULL DEFAULT 0,
    "totalPaidCents" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentDate" DATE,
    "nextDueDate" DATE,
    "nextDueCents" INTEGER NOT NULL DEFAULT 0,
    "pendingVerificationCents" INTEGER NOT NULL DEFAULT 0,
    "inDuplumCapped" BOOLEAN NOT NULL DEFAULT false,
    "settledOn" DATE,
    "recomputedAt" TIMESTAMP(3),

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayment_schedules" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "interestCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "arrangementId" UUID,
    "supersededOn" DATE,
    "supersededPaidCents" INTEGER,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "remainingCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueCents" INTEGER NOT NULL DEFAULT 0,
    "status" "InstalmentStatus" NOT NULL DEFAULT 'UPCOMING',
    "fullyPaidOn" DATE,
    "lastPaymentDate" DATE,
    "collectionStatus" "CollectionStatus" NOT NULL DEFAULT 'NONE',
    "promiseDate" DATE,

    CONSTRAINT "repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayment_arrangements" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "previousVersion" INTEGER NOT NULL,
    "newVersion" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "numberOfInstalments" INTEGER NOT NULL,
    "firstDueDate" DATE NOT NULL,
    "instalmentCents" INTEGER NOT NULL,
    "balanceAtArrangementCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "authorisedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repayment_arrangements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "transactionNumber" TEXT NOT NULL,
    "loanId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledInstalmentCents" INTEGER NOT NULL,
    "balanceBeforeCents" INTEGER NOT NULL,
    "replacesPaymentId" UUID,
    "overpaymentFlag" BOOLEAN NOT NULL DEFAULT false,
    "overpaymentResolvedAt" TIMESTAMP(3),
    "overpaymentResolution" TEXT,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "component" "AllocationComponent" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_adjustments" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "kind" "PaymentAdjustmentKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "replacementPaymentId" UUID,
    "authorisedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_adjustments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "kind" "LoanAdjustmentKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "authorisedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reversalReason" TEXT,

    CONSTRAINT "loan_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_verifications" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "action" "VerificationAction" NOT NULL,
    "notes" TEXT,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "recordedCents" INTEGER NOT NULL,
    "actualCents" INTEGER NOT NULL,
    "varianceCents" INTEGER NOT NULL,
    "notes" TEXT,
    "reconciledById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_notes" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "instalmentId" UUID,
    "outcome" "FollowUpOutcome" NOT NULL,
    "note" TEXT NOT NULL,
    "promiseDate" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "loanId" UUID,
    "instalmentId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "readById" UUID,
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'NOT_SENT',
    "emailError" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_documents" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "loanId" UUID,
    "paymentId" UUID,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "clients_clientNumber_key" ON "clients"("clientNumber");

-- CreateIndex
CREATE UNIQUE INDEX "clients_idNumber_key" ON "clients"("idNumber");

-- CreateIndex
CREATE INDEX "clients_lastName_firstName_idx" ON "clients"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applications_applicationNumber_key" ON "loan_applications"("applicationNumber");

-- CreateIndex
CREATE INDEX "loan_applications_status_idx" ON "loan_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loans_reference_key" ON "loans"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "loans_applicationId_key" ON "loans"("applicationId");

-- CreateIndex
CREATE INDEX "loans_clientId_idx" ON "loans"("clientId");

-- CreateIndex
CREATE INDEX "loans_status_idx" ON "loans"("status");

-- CreateIndex
CREATE INDEX "repayment_schedules_dueDate_idx" ON "repayment_schedules"("dueDate");

-- CreateIndex
CREATE INDEX "repayment_schedules_status_idx" ON "repayment_schedules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_schedules_loanId_version_seq_key" ON "repayment_schedules"("loanId", "version", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_transactionNumber_key" ON "payment_transactions"("transactionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_idempotencyKey_key" ON "payment_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_replacesPaymentId_key" ON "payment_transactions"("replacesPaymentId");

-- CreateIndex
CREATE INDEX "payment_transactions_loanId_paymentDate_idx" ON "payment_transactions"("loanId", "paymentDate");

-- CreateIndex
CREATE INDEX "payment_transactions_paymentDate_idx" ON "payment_transactions"("paymentDate");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_loanId_idx" ON "payment_allocations"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_adjustments_replacementPaymentId_key" ON "payment_adjustments"("replacementPaymentId");

-- CreateIndex
CREATE INDEX "loan_adjustments_loanId_idx" ON "loan_adjustments"("loanId");

-- CreateIndex
CREATE INDEX "payment_verifications_paymentId_idx" ON "payment_verifications"("paymentId");

-- CreateIndex
CREATE INDEX "reconciliations_date_idx" ON "reconciliations"("date");

-- CreateIndex
CREATE INDEX "follow_up_notes_loanId_idx" ON "follow_up_notes"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_readAt_idx" ON "notifications"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "loan_documents_storageKey_key" ON "loan_documents"("storageKey");

-- CreateIndex
CREATE INDEX "loan_documents_clientId_idx" ON "loan_documents"("clientId");

-- CreateIndex
CREATE INDEX "loan_documents_loanId_idx" ON "loan_documents"("loanId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_arrangements" ADD CONSTRAINT "repayment_arrangements_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_adjustments" ADD CONSTRAINT "loan_adjustments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_verifications" ADD CONSTRAINT "payment_verifications_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_notes" ADD CONSTRAINT "follow_up_notes_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_notes" ADD CONSTRAINT "follow_up_notes_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "repayment_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "repayment_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
