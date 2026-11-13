import { Controller, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AuthUser, CurrentUser, OwnerOnly, Public } from '../common/decorators';
import { LoansModule } from '../loans/loans.module';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsModule } from '../settings/settings.module';
import { RemindersService } from './reminders.service';

@Controller()
class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
  ) {}

  @Get('notifications')
  list(@Query('unread') unread?: string, @Query('type') type?: string) {
    return this.prisma.notification.findMany({
      where: { ...(unread === 'true' ? { readAt: null } : {}), ...(type ? { type: type as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { loan: { select: { id: true, reference: true } } },
    });
  }

  @Get('notifications/count')
  async count() {
    return { unread: await this.prisma.notification.count({ where: { readAt: null } }) };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date(), readById: user.id } });
    return { ok: true };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date(), readById: user.id } });
    return { updated: r.count };
  }

  /** Runs the reminder job now (owner). Safe to repeat: reminders are de-duplicated. */
  @OwnerOnly()
  @Post('notifications/run-now')
  @HttpCode(200)
  runNow() {
    return this.reminders.run();
  }

  /**
   * For hosts where the API doesn't run continuously (serverless): an external scheduler calls this
   * every 5-15 minutes with the `x-cron-secret` header.
   */
  @Public()
  @Post('jobs/run')
  @HttpCode(200)
  async cron(@Headers('x-cron-secret') secret?: string) {
    const expected = process.env.CRON_SECRET ?? '';
    const ok = expected.length >= 16 && secret !== undefined && secret.length === expected.length && timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException();
    return this.reminders.run();
  }
}

@Module({ imports: [LoansModule, SettingsModule], providers: [RemindersService], controllers: [NotificationsController], exports: [RemindersService] })
export class NotificationsModule {}
