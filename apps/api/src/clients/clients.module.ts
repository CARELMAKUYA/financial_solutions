import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApplicationStatus, Frequency, Prisma, ProductType } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { todaySast } from '../common/dates';
import { AuthUser, CurrentUser } from '../common/decorators';
import { checkCoverage, requiredStatementCount, requireStatements, statementCheck } from '../common/statements';
import { IsSaIdNumber, nextNumber, normalisePhone } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';

class ClientDto {
  @IsString() @MinLength(1) @MaxLength(80) firstName: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName: string;
  @IsSaIdNumber() idNumber: string;
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsString() @MaxLength(20) altPhone?: string;
  @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail({}, { message: 'Enter a valid email address' }) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) employer?: string;
  @IsOptional() @IsString() @MaxLength(20) employerPhone?: string;
  @IsOptional() @IsInt() @Min(0) monthlyIncomeCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) payday?: number;
  @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @IsOptional() @IsString() @MaxLength(30) bankAccountNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class UpdateClientDto {
  // Empty strings / null clear a field.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;
  @IsOptional() @IsSaIdNumber() idNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) altPhone?: string;
  @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail({}, { message: 'Enter a valid email address' }) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) employer?: string;
  @IsOptional() @IsString() @MaxLength(20) employerPhone?: string;
  @IsOptional() @ValidateIf((o) => o.monthlyIncomeCents !== null) @IsInt() @Min(0) monthlyIncomeCents?: number | null;
  @IsOptional() @ValidateIf((o) => o.payday !== null) @IsInt() @Min(1) @Max(31) payday?: number | null;
  @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @IsOptional() @IsString() @MaxLength(30) bankAccountNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

class ApplicationDto {
  @IsEnum(ProductType) product: ProductType;
  @IsInt() @Min(10_000) @Max(100_000_000) requestedAmountCents: number;
  @IsInt() @Min(1) @Max(120) requestedInstalments: number;
  @IsEnum(Frequency) frequency: Frequency;
  @IsOptional() @IsString() @MaxLength(500) purpose?: string;
  @IsOptional() @IsInt() @Min(0) monthlyIncomeCents?: number;
  @IsOptional() @IsInt() @Min(0) monthlyExpensesCents?: number;
}

class DecisionDto {
  @IsIn(['APPROVED', 'DECLINED', 'WITHDRAWN']) status: 'APPROVED' | 'DECLINED' | 'WITHDRAWN';
  @IsOptional() @IsString() @MaxLength(1000) decisionNotes?: string;
}

function cleanContact<T extends { phone?: string; altPhone?: string; employerPhone?: string; email?: string }>(dto: T): T {
  const out = { ...dto };
  for (const k of ['phone', 'altPhone', 'employerPhone'] as const) {
    const v = out[k];
    if (v === undefined) continue;
    if (v === '' && k !== 'phone') {
      (out as Record<string, unknown>)[k] = null;
      continue;
    }
    const n = normalisePhone(v);
    if (!n) throw new BadRequestException(`Enter a valid South African phone number for ${k === 'phone' ? 'phone' : k === 'altPhone' ? 'alternative phone' : 'employer phone'}`);
    out[k] = n;
  }
  if (out.email !== undefined) (out as Record<string, unknown>).email = out.email.trim().toLowerCase() || null;
  for (const k of ['address', 'employer', 'bankName', 'bankAccountNumber', 'notes']) {
    const v = (out as Record<string, unknown>)[k];
    if (typeof v === 'string') (out as Record<string, unknown>)[k] = v.trim() || null;
  }
  return out;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(search?: string, status?: string) {
    const where: Prisma.ClientWhereInput = {};
    if (status) where.status = status as 'ACTIVE' | 'ARCHIVED';
    if (search?.trim()) {
      const s = search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { idNumber: { contains: s } },
        { phone: { contains: s.replace(/^0/, '') } },
        { clientNumber: { contains: s, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
      include: {
        loans: { where: { status: 'ACTIVE' }, select: { id: true, totalOutstandingCents: true, arrearsCents: true } },
      },
    });
  }

  async get(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        loans: { orderBy: { createdAt: 'desc' } },
        applications: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    const count = await requiredStatementCount(this.prisma);
    // What a new application today would need.
    const statements = count > 0 ? await statementCheck(this.prisma, id, todaySast(), count) : null;
    return { ...client, statements };
  }

  async create(dto: ClientDto, user: AuthUser) {
    const data = cleanContact(dto);
    if (await this.prisma.client.findUnique({ where: { idNumber: data.idNumber } })) {
      throw new ConflictException('A client with this ID number already exists');
    }
    return this.prisma.$transaction(async (tx) => {
      const clientNumber = await nextNumber(tx, 'client', 'TQC-', 5);
      const client = await tx.client.create({ data: { ...data, clientNumber, createdById: user.id } });
      await this.audit.log(user.id, 'CLIENT_CREATED', 'Client', client.id, { clientNumber }, tx);
      return client;
    });
  }

  async update(id: string, dto: UpdateClientDto, user: AuthUser) {
    const data = cleanContact(dto);
    const before = await this.prisma.client.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Client not found');
    if (data.idNumber && data.idNumber !== before.idNumber && (await this.prisma.client.findUnique({ where: { idNumber: data.idNumber } }))) {
      throw new ConflictException('A client with this ID number already exists');
    }
    const updated = await this.prisma.client.update({ where: { id }, data });
    // Record which fields changed (not their values: POPIA data minimisation in the log).
    await this.audit.log(user.id, 'CLIENT_UPDATED', 'Client', id, { fields: Object.keys(dto).filter((k) => (before as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]) });
    return updated;
  }

  async createApplication(clientId: string, dto: ApplicationDto, user: AuthUser) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    return this.prisma.$transaction(async (tx) => {
      const year = todaySast().slice(0, 4);
      const applicationNumber = await nextNumber(tx, `application-${year}`, `TQA-${year}-`, 5);
      const app = await tx.loanApplication.create({ data: { ...dto, clientId, applicationNumber, createdById: user.id } });
      await this.audit.log(user.id, 'APPLICATION_CREATED', 'LoanApplication', app.id, { applicationNumber, requestedAmountCents: dto.requestedAmountCents }, tx);
      return app;
    });
  }

  async listApplications(status?: ApplicationStatus) {
    const apps = await this.prisma.loanApplication.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { client: { select: { id: true, firstName: true, lastName: true, clientNumber: true } }, loan: { select: { id: true, reference: true } } },
    });
    const count = await requiredStatementCount(this.prisma);
    if (count <= 0) return apps.map((a) => ({ ...a, statements: null }));
    const docs = await this.prisma.loanDocument.findMany({
      where: { clientId: { in: [...new Set(apps.map((a) => a.clientId))] }, kind: 'BANK_STATEMENT', periodFrom: { not: null } },
      select: { clientId: true, periodFrom: true, periodTo: true },
    });
    return apps.map((a) => ({ ...a, statements: checkCoverage(todaySast(a.createdAt), count, docs.filter((d) => d.clientId === a.clientId)) }));
  }

  async getApplication(id: string) {
    const app = await this.prisma.loanApplication.findUnique({ where: { id }, include: { client: true, loan: { select: { id: true, reference: true } } } });
    if (!app) throw new NotFoundException('Application not found');
    const count = await requiredStatementCount(this.prisma);
    return { ...app, statements: count > 0 ? await statementCheck(this.prisma, app.clientId, todaySast(app.createdAt), count) : null };
  }

  async decide(id: string, dto: DecisionDto, user: AuthUser) {
    const app = await this.prisma.loanApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status === 'ISSUED') throw new ConflictException('A loan has already been issued for this application');
    if (dto.status === 'APPROVED') {
      await requireStatements(this.prisma, app.clientId, todaySast(app.createdAt), await requiredStatementCount(this.prisma), 'approving this application');
    }
    const updated = await this.prisma.loanApplication.update({
      where: { id },
      data: { status: dto.status, decisionNotes: dto.decisionNotes, decidedById: user.id, decidedAt: new Date() },
    });
    await this.audit.log(user.id, `APPLICATION_${dto.status}`, 'LoanApplication', id, { notes: dto.decisionNotes });
    return updated;
  }
}

@Controller()
class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('clients')
  list(@Query('search') search?: string, @Query('status') status?: string) {
    return this.clients.list(search, status);
  }

  @Post('clients')
  create(@Body() dto: ClientDto, @CurrentUser() user: AuthUser) {
    return this.clients.create(dto, user);
  }

  @Get('clients/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  @Patch('clients/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto, @CurrentUser() user: AuthUser) {
    return this.clients.update(id, dto, user);
  }

  @Post('clients/:id/applications')
  createApplication(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplicationDto, @CurrentUser() user: AuthUser) {
    return this.clients.createApplication(id, dto, user);
  }

  @Get('applications')
  listApplications(@Query('status') status?: ApplicationStatus) {
    return this.clients.listApplications(status || undefined);
  }

  @Get('applications/:id')
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.getApplication(id);
  }

  @Post('applications/:id/decision')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.clients.decide(id, dto, user);
  }
}

@Module({ providers: [ClientsService], controllers: [ClientsController] })
export class ClientsModule {}
