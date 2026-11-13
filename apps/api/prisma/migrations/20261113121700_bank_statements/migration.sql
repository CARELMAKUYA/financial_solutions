-- AlterTable
ALTER TABLE "loan_documents" ADD COLUMN     "periodFrom" TEXT,
ADD COLUMN     "periodTo" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "requiredStatementMonths" INTEGER NOT NULL DEFAULT 3;

-- A statement period is a pair of valid months, in order, and only bank statements have one.
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_period_check" CHECK (
  ("periodFrom" IS NULL AND "periodTo" IS NULL)
  OR (
    "kind" = 'BANK_STATEMENT'
    AND "periodFrom" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND "periodTo" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND "periodFrom" <= "periodTo"
  )
);
ALTER TABLE "settings" ADD CONSTRAINT "settings_statement_months_check" CHECK ("requiredStatementMonths" BETWEEN 0 AND 12);
