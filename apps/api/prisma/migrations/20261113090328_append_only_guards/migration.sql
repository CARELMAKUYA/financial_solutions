-- Financial history is append-only. These guards hold even if application code has a bug or
-- someone edits the database directly with the application's credentials.

-- Payments: the money facts can never change. Only status / verification / overpayment-review fields may.
CREATE OR REPLACE FUNCTION tq_guard_payment_update() RETURNS trigger AS $$
BEGIN
  IF NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW."paymentDate" IS DISTINCT FROM OLD."paymentDate"
     OR NEW."loanId" IS DISTINCT FROM OLD."loanId"
     OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
     OR NEW."method" IS DISTINCT FROM OLD."method"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt"
     OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
     OR NEW."transactionNumber" IS DISTINCT FROM OLD."transactionNumber"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."balanceBeforeCents" IS DISTINCT FROM OLD."balanceBeforeCents"
     OR NEW."scheduledInstalmentCents" IS DISTINCT FROM OLD."scheduledInstalmentCents" THEN
    RAISE EXCEPTION 'Payment transactions cannot be edited. Reverse or correct the payment instead.';
  END IF;
  IF OLD."status" IN ('REVERSED', 'REJECTED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'A reversed or rejected payment cannot be reinstated. Record a new payment instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_transactions_guard_update
  BEFORE UPDATE ON "payment_transactions"
  FOR EACH ROW EXECUTE FUNCTION tq_guard_payment_update();

-- Allocations: only supersededAt may be set, once.
CREATE OR REPLACE FUNCTION tq_guard_allocation_update() RETURNS trigger AS $$
BEGIN
  IF OLD."supersededAt" IS NOT NULL
     OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."component" IS DISTINCT FROM OLD."component"
     OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW."balanceAfterCents" IS DISTINCT FROM OLD."balanceAfterCents" THEN
    RAISE EXCEPTION 'Payment allocations are append-only.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_guard_update
  BEFORE UPDATE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION tq_guard_allocation_update();

-- Loan adjustments: only the reversal fields may be set, once.
CREATE OR REPLACE FUNCTION tq_guard_loan_adjustment_update() RETURNS trigger AS $$
BEGIN
  IF OLD."reversedAt" IS NOT NULL
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
     OR NEW."loanId" IS DISTINCT FROM OLD."loanId" THEN
    RAISE EXCEPTION 'Loan adjustments cannot be edited. Reverse the adjustment instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loan_adjustments_guard_update
  BEFORE UPDATE ON "loan_adjustments"
  FOR EACH ROW EXECUTE FUNCTION tq_guard_loan_adjustment_update();

-- Nothing in the financial record or the audit trail can be deleted or (for the audit log) changed.
CREATE OR REPLACE FUNCTION tq_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is part of the audit trail.', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_transactions_no_delete BEFORE DELETE ON "payment_transactions" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER payment_allocations_no_delete BEFORE DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER payment_adjustments_no_change BEFORE UPDATE OR DELETE ON "payment_adjustments" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER payment_verifications_no_change BEFORE UPDATE OR DELETE ON "payment_verifications" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER loan_adjustments_no_delete BEFORE DELETE ON "loan_adjustments" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER repayment_arrangements_no_change BEFORE UPDATE OR DELETE ON "repayment_arrangements" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER reconciliations_no_change BEFORE UPDATE OR DELETE ON "reconciliations" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();
CREATE TRIGGER repayment_schedules_no_delete BEFORE DELETE ON "repayment_schedules" FOR EACH ROW EXECUTE FUNCTION tq_forbid_change();

-- Money can't be negative where it would make no sense.
ALTER TABLE "payment_transactions" ADD CONSTRAINT payment_amount_positive CHECK ("amountCents" > 0);
ALTER TABLE "loan_adjustments" ADD CONSTRAINT adjustment_amount_positive CHECK ("amountCents" > 0);
ALTER TABLE "loans" ADD CONSTRAINT loan_balances_non_negative CHECK (
  "principalOutstandingCents" >= 0 AND "interestOutstandingCents" >= 0 AND "feesOutstandingCents" >= 0
  AND "totalOutstandingCents" >= 0 AND "overpaymentCents" >= 0
);
