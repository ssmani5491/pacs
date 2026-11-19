import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private redis: Redis;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {
    this.redis = new Redis({
      host: config.get('REDIS_HOST'),
      port: Number(config.get('REDIS_PORT')),
      password: config.get('REDIS_PASSWORD'),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.redis.connect().catch(() => undefined);
  }

  async hashPassword(plain: string): Promise<string> {
    const pepper = this.config.get<string>('PASSWORD_PEPPER') ?? '';
    return argon2.hash(plain + pepper, { type: argon2.argon2id });
  }

  private async verifyPassword(hash: string, plain: string): Promise<boolean> {
    const pepper = this.config.get<string>('PASSWORD_PEPPER') ?? '';
    try {
      return await argon2.verify(hash, plain + pepper);
    } catch {
      return false;
    }
  }

  /**
   * Step-up re-authentication for sensitive actions (e.g. report signing).
   * Verifies the given password against the user's current hash. Does NOT issue
   * tokens or mutate state. Returns false for inactive/missing users.
   */
  async verifyUserPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) return false;
    return this.verifyPassword(user.passwordHash, password);
  }

  async login(username: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });

    if (!user || !user.active) {
      await this.audit.log({ action: 'LOGIN_FAILED', detail: { username, reason: 'no_user' }, ip });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ userId: user.id, action: 'LOGIN_FAILED', detail: { reason: 'locked' }, ip });
      throw new UnauthorizedException('Account temporarily locked');
    }

    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : null,
        },
      });
      await this.audit.log({ userId: user.id, action: 'LOGIN_FAILED', detail: { failed }, ip });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'LOGIN', ip });

    return this.issueTokens(user.id, user.username);
  }

  private async issueTokens(userId: string, username: string) {
    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, username, type: 'access' },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: Number(this.config.get('JWT_ACCESS_TTL')),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, username, type: 'refresh', jti },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: Number(this.config.get('JWT_REFRESH_TTL')),
      },
    );
    // Store active refresh jti so it can be rotated/revoked.
    const ttl = Number(this.config.get('JWT_REFRESH_TTL'));
    await this.redis.set(`refresh:${userId}:${jti}`, '1', 'EX', ttl).catch(() => undefined);
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Wrong token type');

    const key = `refresh:${payload.sub}:${payload.jti}`;
    const exists = await this.redis.get(key).catch(() => null);
    if (!exists) throw new UnauthorizedException('Refresh token revoked or expired');

    // Rotate: delete old jti, issue a fresh pair.
    await this.redis.del(key).catch(() => undefined);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException('User inactive');
    return this.issueTokens(user.id, user.username);
  }

  async logout(userId: string) {
    // Revoke all refresh tokens for the user.
    const keys = await this.redis.keys(`refresh:${userId}:*`).catch(() => []);
    if (keys.length) await this.redis.del(...keys).catch(() => undefined);
    await this.audit.log({ userId, action: 'LOGOUT' });
    return { success: true };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await this.verifyPassword(user.passwordHash, current);
    if (!ok) throw new BadRequestException('Current password incorrect');

    const passwordHash = await this.hashPassword(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.logout(userId); // force re-login everywhere
    await this.audit.log({ userId, action: 'PASSWORD_CHANGE' });
    return { success: true };
  }
}
