import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthorisedForCorrections, AuthUser, CurrentUser } from '../common/decorators';
import { IsDateOnly } from '../common/util';
import { PdfService } from '../documents/pdf.service';
import { CorrectPaymentDto, LoansModule, sendPdf } from '../loans/loans.module';
import { ReasonDto } from '../loans/loans.dto';
import { PaymentsService } from './payments.service';

class VerifyDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class OverpaymentDto {
  @IsString() @MinLength(5, { message: 'Describe how the overpayment was resolved' }) @MaxLength(1000) resolution: string;
  @IsOptional() @IsInt() @Min(1) refundCents?: number;
  @IsOptional() @IsDateOnly() refundDate?: string;
}

class PaymentListQuery {
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsIn(['PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'REVERSED']) status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['true', 'false']) overpayments?: string;
}

@Controller('payments')
class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  list(@Query() q: PaymentListQuery) {
    return this.payments.list({ ...q, overpayments: q.overpayments === 'true' });
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto, @CurrentUser() user: AuthUser) {
    return this.payments.verify(id, dto.approve, dto.notes, user);
  }

  @AuthorisedForCorrections()
  @Post(':id/reverse')
  @HttpCode(200)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.payments.reverse(id, dto.reason, user);
  }

  @AuthorisedForCorrections()
  @Post(':id/correct')
  @HttpCode(200)
  correct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payments.correct(id, dto, user);
  }

  @AuthorisedForCorrections()
  @Post(':id/overpayment')
  @HttpCode(200)
  resolveOverpayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OverpaymentDto, @CurrentUser() user: AuthUser) {
    return this.payments.resolveOverpayment(id, dto, user);
  }

  @Get(':id/receipt.pdf')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendPdf(res, await this.pdf.receipt(id));
  }
}

@Module({ imports: [LoansModule], controllers: [PaymentsController] })
export class PaymentsModule {}
