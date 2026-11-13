import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentKind } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID, Matches, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuditService } from '../common/audit.service';
import { todaySast } from '../common/dates';
import { AuthUser, CurrentUser } from '../common/decorators';
import { MONTH_RE, monthsBetween } from '../common/statements';
import { PrismaService } from '../prisma/prisma.service';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function uploadDir() {
  const dir = resolve(process.env.UPLOAD_DIR ?? './uploads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Checks the file's magic bytes, not just the browser-supplied type. */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

class UploadDto {
  @IsEnum(DocumentKind) kind: DocumentKind;
  @IsOptional() @IsUUID() loanId?: string;
  /** Bank statements only: first and last month covered, YYYY-MM. */
  @ValidateIf((o) => o.kind === 'BANK_STATEMENT') @Matches(MONTH_RE, { message: 'Choose the first month the statement covers' }) periodFrom?: string;
  @ValidateIf((o) => o.kind === 'BANK_STATEMENT') @Matches(MONTH_RE, { message: 'Choose the last month the statement covers' }) periodTo?: string;
}

@Controller()
class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async store(
    file: Express.Multer.File | undefined,
    data: { clientId: string; loanId?: string; paymentId?: string; kind: DocumentKind; periodFrom?: string; periodTo?: string },
    user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    if (data.kind === 'BANK_STATEMENT') {
      if (!data.periodFrom || !data.periodTo) throw new BadRequestException('Choose the months the bank statement covers');
      if (data.periodFrom > data.periodTo) throw new BadRequestException('The first month must be before the last month');
      if (data.periodTo > todaySast().slice(0, 7)) throw new BadRequestException('A bank statement cannot cover a future month');
      if (monthsBetween(data.periodFrom, data.periodTo).length > 12) throw new BadRequestException('A single statement can cover at most 12 months');
    } else {
      data = { ...data, periodFrom: undefined, periodTo: undefined };
    }
    const type = sniff(file.buffer);
    if (!type || !ALLOWED[type]) throw new BadRequestException('Only PDF, JPG, PNG or WEBP files can be uploaded');
    const storageKey = `${randomUUID()}.${ALLOWED[type]}`;
    writeFileSync(join(uploadDir(), storageKey), file.buffer);
    const doc = await this.prisma.loanDocument.create({
      data: {
        ...data,
        fileName: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `document.${ALLOWED[type]}`,
        mimeType: type,
        sizeBytes: file.size,
        storageKey,
        uploadedById: user.id,
      },
    });
    await this.audit.log(user.id, 'DOCUMENT_UPLOADED', 'LoanDocument', doc.id, { kind: data.kind, clientId: data.clientId, loanId: data.loanId, paymentId: data.paymentId, periodFrom: data.periodFrom, periodTo: data.periodTo });
    return doc;
  }

  @Post('clients/:id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadClientDoc(@Param('id', ParseUUIDPipe) clientId: string, @Body() dto: UploadDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (dto.loanId) {
      const loan = await this.prisma.loan.findUnique({ where: { id: dto.loanId } });
      if (!loan || loan.clientId !== clientId) throw new BadRequestException('Loan not found for this client');
    }
    return this.store(file, { clientId, loanId: dto.loanId, kind: dto.kind, periodFrom: dto.periodFrom, periodTo: dto.periodTo }, user);
  }

  /** Proof of payment, attached to a recorded payment. */
  @Post('payments/:id/proof')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadProof(@Param('id', ParseUUIDPipe) paymentId: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.store(file, { clientId: payment.clientId, loanId: payment.loanId, paymentId, kind: 'PROOF_OF_PAYMENT' }, user);
  }

  @Get('documents/:id')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const doc = await this.prisma.loanDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    const path = join(uploadDir(), doc.storageKey);
    if (!existsSync(path)) throw new NotFoundException('The file is missing from storage');
    await this.audit.log(user.id, 'DOCUMENT_VIEWED', 'LoanDocument', id, { clientId: doc.clientId });
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path).pipe(res);
  }
}

@Module({ controllers: [DocumentsController] })
export class DocumentsModule {}
