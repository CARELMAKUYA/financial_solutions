import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { ClientsModule } from './clients/clients.module';
import { AuditModule } from './common/audit.service';
import { Public } from './common/decorators';
import { DocumentsModule } from './documents/documents.module';
import { LoansModule } from './loans/loans.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Reports database reachability without revealing connection details. */
  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const users = await this.prisma.user.count();
      return { ok: true, database: users ? 'connected' : 'connected, but no users yet (run the seed)' };
    } catch (err) {
      const code = (err as { code?: string }).code;
      return { ok: false, database: code === 'P2021' ? 'connected, but tables are missing (run migrations)' : `unreachable${code ? ` (${code})` : ''}` };
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    SettingsModule,
    UsersModule,
    ClientsModule,
    LoansModule,
    PaymentsModule,
    ReportsModule,
    NotificationsModule,
    DocumentsModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
