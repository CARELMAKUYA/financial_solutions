import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthedRequest, CORRECTIONS, IS_PUBLIC, ROLES } from '../common/decorators';
import { AuthService, SESSION_COOKIE } from './auth.service';

/** Global guard: every route needs a valid session unless marked @Public(), then checks @Roles(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    const resolved = token ? await this.auth.resolve(token) : null;
    if (!resolved) throw new UnauthorizedException('Please sign in');
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(resolved.user.role)) {
      throw new ForbiddenException('Only the owner can do this');
    }
    if (this.reflector.getAllAndOverride<boolean>(CORRECTIONS, targets) && !resolved.user.canAuthoriseCorrections) {
      throw new ForbiddenException('Only administrators authorised for corrections can do this');
    }
    return true;
  }
}
