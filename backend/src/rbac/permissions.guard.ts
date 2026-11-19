import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { PermissionKey } from './permissions';

/** Reads the authenticated user (set by JwtAuthGuard) and checks required permissions. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('No authenticated user');
    if (user.isSuperAdmin) return true;

    const held: Set<string> = new Set(user.permissions ?? []);
    const ok = required.every((p) => held.has(p));
    if (!ok) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
