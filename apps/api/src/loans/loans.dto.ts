import { Frequency, FollowUpOutcome, LoanAdjustmentKind, ProductType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsDateOnly } from '../common/util';

export class QuoteDto {
  @IsInt() @Min(10_000, { message: 'The loan amount must be at least R 100' }) @Max(100_000_000) loanAmountCents: number;
  @IsInt() @Min(0) @Max(10_000_000) initiationFeeCents: number;
  @IsInt() @Min(0) @Max(10_000, { message: 'Interest rate looks too high' }) monthlyRateBps: number;
  @IsInt() @Min(0) @Max(1_000_000) serviceFeeCents: number;
  @IsInt() @Min(1) @Max(120) numberOfInstalments: number;
  @IsEnum(Frequency) frequency: Frequency;
  @IsDateOnly() disbursedOn: string;
  @IsDateOnly() firstDueDate: string;
}

export class CreateLoanDto extends QuoteDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() applicationId?: string;
  @IsEnum(ProductType) product: ProductType;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ArrangementDto {
  @IsDateOnly() firstDueDate: string;
  @IsInt() @Min(1) @Max(120) numberOfInstalments: number;
  @IsEnum(Frequency) frequency: Frequency;
  @IsOptional() @IsString() @MinLength(5, { message: 'Give a reason for the new arrangement' }) @MaxLength(1000) reason?: string;
}

export class LoanAdjustmentDto {
  @IsEnum(LoanAdjustmentKind) kind: LoanAdjustmentKind;
  @IsInt() @Min(1) @Max(100_000_000) amountCents: number;
  @IsDateOnly() effectiveDate: string;
  @IsString() @MinLength(5, { message: 'Give a reason (at least 5 characters)' }) @MaxLength(1000) reason: string;
}

export class ReasonDto {
  @IsString() @MinLength(5, { message: 'Give a reason (at least 5 characters)' }) @MaxLength(1000) reason: string;
}

export class FollowUpDto {
  @IsOptional() @IsUUID() instalmentId?: string;
  @IsEnum(FollowUpOutcome) outcome: FollowUpOutcome;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
  @IsOptional() @IsDateOnly() promiseDate?: string;
}
