import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/decorators';

export const SESSION_COOKIE = 'tq_sid';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

@Injectable()
export class AuthService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.ttlMs = Number(config.get('SESSION_TTL_HOURS') ?? 12) * 3_600_000;
  }

  get sessionTtlMs() {
    return this.ttlMs;
  }

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      await this.audit.log(user?.id ?? null, 'LOGIN_FAILED', 'User', user?.id, { email });
      throw new UnauthorizedException('Incorrect email or password');
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + this.ttlMs),
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    return { token, user: toAuthUser(user) };
  }

  /** Resolves a cookie token to a user, sliding the expiry forward once past half its life. */
  async resolve(token: string): Promise<{ user: AuthUser; sessionId: string } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (session.expiresAt.getTime() - Date.now() < this.ttlMs / 2) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + this.ttlMs) },
      });
    }
    return { user: toAuthUser(session.user), sessionId: session.id };
  }

  async logout(sessionId: string, userId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
    await this.audit.log(userId, 'LOGOUT', 'User', userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    // Sign out every other device.
    await this.prisma.session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
    await this.audit.log(userId, 'PASSWORD_CHANGED', 'User', userId);
  }
}

function toAuthUser(u: { id: string; name: string; email: string; role: AuthUser['role']; canAuthoriseCorrections: boolean }): AuthUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, canAuthoriseCorrections: u.role === 'OWNER' || u.canAuthoriseCorrections };
}
