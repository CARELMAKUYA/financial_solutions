import { BadRequestException, Body, ConflictException, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { hashPassword } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEmail() email: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsBoolean() canAuthoriseCorrections?: boolean;
  @IsOptional() @IsBoolean() receiveEmails?: boolean;
  @IsString() @MinLength(10, { message: 'Password must be at least 10 characters' }) password: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() canAuthoriseCorrections?: boolean;
  @IsOptional() @IsBoolean() receiveEmails?: boolean;
  @IsOptional() @IsString() @MinLength(10, { message: 'Password must be at least 10 characters' }) password?: string;
}

const userSelect = { id: true, name: true, email: true, role: true, active: true, canAuthoriseCorrections: true, receiveEmails: true, lastLoginAt: true, createdAt: true };

@OwnerOnly()
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  list() {
    return this.prisma.user.findMany({ select: userSelect, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  @Post('users')
  async create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('An administrator with that email already exists');
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        role: dto.role,
        canAuthoriseCorrections: dto.canAuthoriseCorrections ?? false,
        receiveEmails: dto.receiveEmails ?? true,
        passwordHash: await hashPassword(dto.password),
      },
      select: userSelect,
    });
    await this.audit.log(me.id, 'USER_CREATED', 'User', user.id, { email, role: dto.role, canAuthoriseCorrections: user.canAuthoriseCorrections });
    return user;
  }

  @Patch('users/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    if (id === me.id && (dto.active === false || (dto.role && dto.role !== Role.OWNER))) {
      throw new BadRequestException('You cannot deactivate or demote your own account');
    }
    const { password, ...rest } = dto;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
      select: userSelect,
    });
    // Deactivating, changing permissions or resetting a password signs the user out everywhere.
    if (id !== me.id && (dto.active === false || password || dto.role || dto.canAuthoriseCorrections !== undefined)) {
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    await this.audit.log(me.id, 'USER_UPDATED', 'User', id, { ...rest, passwordReset: !!password });
    return user;
  }

  /** Full audit trail, filterable. */
  @Get('audit-log')
  auditLog(@Query('entity') entity?: string, @Query('action') action?: string, @Query('userId') userId?: string) {
    const where: Prisma.AuditLogWhereInput = {};
    if (entity) where.entity = entity;
    if (action) where.action = { contains: action.toUpperCase() };
    if (userId) where.userId = userId;
    return this.prisma.auditLog.findMany({
      where,
      take: 500,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    });
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
