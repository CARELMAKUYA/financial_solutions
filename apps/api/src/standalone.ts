/**
 * Wires the core services together without Nest's dependency injection, for scripts and tests run
 * with tsx (which doesn't emit the decorator metadata Nest's injector relies on).
 */
import { AuditService } from './common/audit.service';
import { LedgerService } from './loans/ledger.service';
import { LoansService } from './loans/loans.service';
import { RemindersService } from './notifications/reminders.service';
import { PaymentsService } from './payments/payments.service';
import { PrismaService } from './prisma/prisma.service';
import { ReportsService } from './reports/reports.module';
import { SettingsService } from './settings/settings.module';

export function createServices(prisma = new PrismaService()) {
  const settings = new SettingsService(prisma);
  const audit = new AuditService(prisma);
  const ledger = new LedgerService(settings);
  const loans = new LoansService(prisma, ledger, audit);
  const payments = new PaymentsService(prisma, ledger, settings, audit);
  const reminders = new RemindersService(prisma, settings, ledger);
  const reports = new ReportsService(prisma);
  return { prisma, settings, audit, ledger, loans, payments, reminders, reports };
}
