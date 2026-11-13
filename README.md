# Tee Que Financial Solutions: Loan Management

Loan and repayment management for Tee Que Financial Solutions: clients, loan applications, loans, **manual repayment recording**, overdue tracking, a repayment calendar, reminders, reconciliation, statements and reports.

Version 1 records repayments **manually only**. There are no bank feeds, debit orders or payment gateways. An administrator records each payment after confirming the money was received, and everything else (balances, instalment statuses, the calendar, overdue lists, reminders and reports) updates from those records.

Built for South African use: ZAR (`R 1 234.50`), DD/MM/YYYY dates, SAST, SA ID number validation, `+27` phone numbers, National Credit Act payment allocation, and POPIA-minded handling of client data.

## Stack

| Part | Tech |
| --- | --- |
| `apps/web` | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui (Base UI), TanStack Query |
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 14+ |
| Auth | Server-side sessions in Postgres, `httpOnly` cookie, bcrypt password hashes |

The browser only talks to the Next.js app, which forwards `/api/*` to the NestJS API, so the session cookie stays first-party.

## Getting started

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # then set DATABASE_URL
npm run db:migrate                           # creates the tables and the append-only guards
npm run db:seed                              # two logins + fictitious demo clients and loans
npm run dev                                  # API on :4000, web on :3000
```

Sign in at http://localhost:3000:

| Role | Email | Password |
| --- | --- | --- |
| Owner (authorised for corrections) | `owner@teeque.local` | `Owner@123456` |
| Administrator | `admin@teeque.local` | `Admin@123456` |

**Before real use:** change both passwords, fill in the business details and NCR registration number (Settings), check the default rate and fees, and remove the demo clients. The simplest way to remove them is to start from an empty database and run the seed once for the owner account only.

Tests:

```bash
npm test                          # ledger engine: every repayment scenario (no database needed)
npm run test:integration -w api   # against a real Postgres: creates/drops <database>_test
```

## How the money works

All amounts are integer cents. All calculations happen on the server, in [`apps/api/src/loans/engine.ts`](apps/api/src/loans/engine.ts).

**A loan's balance is never edited directly.** It is worked out by replaying the loan terms plus every confirmed payment and authorised adjustment in date order. So a backdated payment, a reversal or a correction always gives exactly the same result as if it had been recorded correctly on the day. After every change the result is saved (balances, instalment statuses, payment allocations) **in the same database transaction** as the payment itself, so a payment can never exist without its balance update.

- **Principal debt** = loan amount + initiation fee (added at disbursement).
- **Interest** is simple daily interest on the outstanding principal: `principal × annual rate × days ÷ 365`, rounded to the cent when it's brought to account (each due date, payment or adjustment).
- **Service fee** is charged on each due date.
- **Instalments** are level amounts worked out on actual day counts so that paying every instalment on its due date clears the loan exactly. The last one absorbs any rounding.
- **Payment allocation** follows the National Credit Act **s126(3)** by default: due or unpaid **interest**, then **fees and charges**, then **principal**. The order is configurable in Settings. Confirm it matches your loan agreements with your compliance adviser.
- **In duplum** (NCA s103(5)), which is on by default: while a loan is in arrears, unpaid interest and fees stop growing once they equal the unpaid principal.
- **Early settlement amount** = principal + interest to today + unpaid fees. Future interest and fees are not charged.
- **Partial payments** are applied to instalments oldest first. An instalment shows **Partially paid** until it's fully covered, and **Overdue** once its due date has passed with money still owing.
- **Overpayments**: the balance never goes below zero. Anything paid beyond the settlement amount is held as an overpayment, flagged for review, and resolved (for example refunded) by an authorised administrator.
- **After the final due date**, everything still owed (including late interest) is due and overdue.

### Recording a payment

1. **Record payment** on the loan profile (or from the calendar or overdue list).
2. Enter the amount, the actual payment date (backdating is allowed, future dates aren't), the method (cash, EFT or bank deposit), and optionally a reference, proof of payment and notes.
3. A confirmation screen shows the calculated allocation, the balance before and after, which instalments it covers, and any warnings: backdated, possible duplicate, overpayment, or that it settles the loan.
4. Confirm. The receipt PDF is available immediately.

**Duplicate protection:** each opening of the form has a unique submission key. A double-click, retry or network hiccup returns the payment that was already saved instead of recording it twice (enforced by a unique database constraint). A second payment with the same amount and date on the same loan has to be explicitly confirmed as separate.

**Verification:** a payment can be flagged "needs verification" when it's recorded, or automatically for chosen methods (Settings). It doesn't affect any balance until someone verifies it, and it can be rejected if the money never arrived.

### Corrections (authorised administrators only)

Nothing financial is ever deleted or overwritten. The database itself refuses (triggers in the `append_only_guards` migration).

- **Reverse** a payment: it stays in the history, marked reversed, with the reason.
- **Correct** a payment: the original is reversed and a linked replacement with the right amount, date or method is recorded in one step.
- **Loan adjustments**: fee or charge, interest waiver, fee waiver, principal write-off, overpayment refund. Each needs a reason and can itself be reversed.
- **Repayment arrangement**: replaces every unpaid instalment with a new schedule for the whole balance, including arrears. The old instalments are kept, marked "rescheduled".

Every change is in the audit log with who, when and what. The audit log can't be edited or deleted.

### Bank statements

Clients supply **3 months of bank statements** with an application. When uploading a bank statement on the client's profile, choose the first and last month it covers. One PDF covering all three months and three monthly files both work.

The statements must cover the **3 full calendar months before the application date**. For an application dated 13/11/2026, that's August, September and October 2026. For a loan issued without an application, the months are counted from the disbursement date. The client profile, the Applications list, the decision dialog and the Issue a loan page all show which months have been received and which are missing.

An application **can't be approved, and a loan can't be issued**, until those months are covered. The number of months is set in Settings → Payments (0 turns the check off).

### Overdue and missed payments

An instalment is overdue when its due date has passed and it isn't fully paid. The **Overdue payments** page tells apart:

- **No payment recorded**: the money may have come in but not been captured yet.
- **Payment awaiting verification**: something was recorded but not yet confirmed.
- **Promise to pay**: the client committed to a date.
- **Confirmed missed**: an administrator checked and no payment was received.

### Reminders

The API runs a reminder job every 5 minutes, whether or not anyone is signed in. At the configured hour (default 07:00 SAST) it creates:

- a reminder N days before a due date (default 3)
- a reminder on the due date
- an overdue reminder the day after an unpaid due date, then every N days (default 7)
- a daily overdue summary each morning
- a weekly collection summary on Mondays

Reminders appear in the dashboard and on the Notifications page, and can also be emailed (Settings → Reminders, needs SMTP in `apps/api/.env`). Each reminder has a unique key in the database, so it is never created twice, even across restarts or multiple servers. If the server was down, the next run catches up. Settled loans get no reminders.

**The API must keep running for reminders to go out.** On a single server, run it as a service (for example with `pm2` or the Windows Task Scheduler at start-up). On hosts where the API doesn't run continuously, set `CRON_SECRET` (16+ characters) and have a scheduler call `POST /api/jobs/run` with the header `x-cron-secret`. Alternatively run `npm run build -w api && npm run jobs:run -w api` on a schedule.

## Roles

| | Administrator | Administrator + corrections | Owner |
| --- | --- | --- | --- |
| Clients, applications, issue loans | ✓ | ✓ | ✓ |
| Record payments, verify or reject unverified payments | ✓ | ✓ | ✓ |
| Follow-ups, reconciliation, reports, statements | ✓ | ✓ | ✓ |
| Reverse or correct payments, loan adjustments, repayment arrangements, overpayment refunds | | ✓ | ✓ |
| Cancel a loan captured in error (no payments) | | | ✓ |
| Settings, administrator accounts, full audit log | | | ✓ |

## Security

- Passwords are bcrypt-hashed. Sessions are random tokens stored hashed, with a 12-hour sliding expiry. Deactivating a user or changing their permissions signs them out.
- Login is rate-limited. Helmet security headers are on. Every request needs a session except `/health`, login and the secret-protected cron trigger.
- Uploads (ID documents, payslips, proof of payment) are limited to PDF, JPG, PNG and WEBP up to 10 MB. Their contents are checked, they're stored under random names outside the web root, and every download is logged.
- Client data changes are logged by field name, not value (POPIA data minimisation).
- Financial tables are append-only at the database level, and balances have non-negative check constraints.
