-- Interest is charged monthly, flat on the original principal debt, instead of daily at a yearly rate.
-- Existing rates are converted: monthly = yearly / 12 (6000 bps a year -> 500 bps a month).
-- Existing schedules keep their stored per-instalment interest, which the ledger now charges on each due date.

ALTER TABLE "loans" RENAME COLUMN "annualRateBps" TO "monthlyRateBps";
UPDATE "loans" SET "monthlyRateBps" = ROUND("monthlyRateBps" / 12.0);

ALTER TABLE "settings" RENAME COLUMN "defaultAnnualRateBps" TO "defaultMonthlyRateBps";
UPDATE "settings" SET "defaultMonthlyRateBps" = ROUND("defaultMonthlyRateBps" / 12.0);
ALTER TABLE "settings" ALTER COLUMN "defaultMonthlyRateBps" SET DEFAULT 500;

ALTER TABLE "settings" ADD COLUMN "chargeFullTermInterest" BOOLEAN NOT NULL DEFAULT true;
