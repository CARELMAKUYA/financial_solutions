import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { PaymentMethod, Prisma, Settings } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuditService, Tx } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tx?: Tx): Promise<Settings> {
    const db = tx ?? this.prisma;
    return (await db.settings.findUnique({ where: { id: 1 } })) ?? db.settings.create({ data: { id: 1 } });
  }
}

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(120) companyName?: string;
  @IsOptional() @IsString() @MaxLength(120) tagline?: string;
  @IsOptional() @IsString() @MaxLength(40) ncrRegistrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) bankDetails?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(['INTEREST', 'FEES', 'PRINCIPAL'], { each: true })
  allocationOrder?: string[];
  @IsOptional() @IsBoolean() inDuplum?: boolean;
  @IsOptional() @IsArray() @IsEnum(PaymentMethod, { each: true }) verifyMethods?: PaymentMethod[];

  @IsOptional() @IsInt() @Min(0) @Max(10_000) defaultMonthlyRateBps?: number;
  @IsOptional() @IsBoolean() chargeFullTermInterest?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) defaultServiceFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) defaultInitiationFeeCents?: number;

  @IsOptional() @IsInt() @Min(0) @Max(12) requiredStatementMonths?: number;

  @IsOptional() @IsInt() @Min(1) @Max(14) @Type(() => Number) reminderDaysBefore?: number;
  @IsOptional() @IsBoolean() remindDueSoon?: boolean;
  @IsOptional() @IsBoolean() remindDueToday?: boolean;
  @IsOptional() @IsBoolean() remindDayAfter?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(60) overdueRepeatDays?: number;
  @IsOptional() @IsBoolean() dailySummary?: boolean;
  @IsOptional() @IsBoolean() weeklySummary?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) reminderHour?: number;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
}

@Controller('settings')
class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get() {
    const s = await this.settings.get();
    return { ...s, smtpConfigured: Boolean(process.env.SMTP_HOST) };
  }

  @OwnerOnly()
  @Put()
  async update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    if (dto.allocationOrder && dto.allocationOrder.length !== 3) {
      dto.allocationOrder = undefined;
    }
    const before = await this.settings.get();
    const updated = await this.prisma.settings.update({ where: { id: 1 }, data: dto as Prisma.SettingsUpdateInput });
    const changed = Object.fromEntries(
      Object.entries(dto)
        .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k]))
        .map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k], to: v }]),
    );
    await this.audit.log(user.id, 'SETTINGS_UPDATED', 'Settings', '1', changed as Prisma.InputJsonValue);
    return updated;
  }
}

@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}
