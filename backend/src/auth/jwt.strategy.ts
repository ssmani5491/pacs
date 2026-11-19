import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, JwtFromRequestFunction } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES } from '../rbac/permissions';

export interface JwtPayload {
  sub: string; // user id
  username: string;
  type: 'access' | 'refresh';
}

/** Name of the HttpOnly cookie carrying the access token for the OHIF viewer /
 * DICOMweb proxy, where OHIF's image loader cannot reliably attach a Bearer
 * header to WADO-RS frame requests. Set by POST /api/viewer/session. */
export const VIEWER_COOKIE = 'pacs_viewer';

// Read the access token from the viewer cookie (fallback to the Authorization
// header). The header path keeps all existing Bearer-auth behaviour unchanged.
const fromViewerCookie: JwtFromRequestFunction = (req: Request) => {
  const raw = (req as any)?.cookies?.[VIEWER_COOKIE];
  return typeof raw === 'string' && raw.length ? raw : null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        fromViewerCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Runs on every protected request; builds the request.user object with permissions.
  async validate(payload: JwtPayload) {
    if (payload.type !== 'access') throw new UnauthorizedException('Wrong token type');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.active) throw new UnauthorizedException('User inactive or missing');

    const roleKeys = user.roles.map((r) => r.role.key);
    const isSuperAdmin = roleKeys.includes('super_admin');
    const permissions = new Set<string>();
    for (const key of roleKeys) {
      const def = ROLES[key];
      if (def) def.permissions.forEach((p) => permissions.add(p));
    }

    return {
      id: user.id,
      username: user.username,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      roles: roleKeys,
      isSuperAdmin,
      permissions: [...permissions],
    };
  }
}
