import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** May reverse/correct payments and post loan adjustments. */
  canAuthoriseCorrections: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser; sessionId?: string };

export const IS_PUBLIC = 'isPublic';
/** Skips the session guard (login, health check, cron trigger with its own secret). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restricts a route to the given roles. Routes without it are open to any signed-in administrator. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const OwnerOnly = () => Roles(Role.OWNER);

export const CORRECTIONS = 'corrections';
/** Only administrators authorised for corrections (owners always are). */
export const AuthorisedForCorrections = () => SetMetadata(CORRECTIONS, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});
