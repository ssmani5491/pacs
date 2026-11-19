import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS } from './permissions';

function ctxWith(user: any, required?: string[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required as any);
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => null,
    getClass: () => null,
  };
  return { guard: new PermissionsGuard(reflector), ctx };
}

describe('PermissionsGuard', () => {
  it('allows when no permissions are required', () => {
    const { guard, ctx } = ctxWith({ permissions: [] }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows super admin regardless of required permissions', () => {
    const { guard, ctx } = ctxWith(
      { isSuperAdmin: true, permissions: [] },
      [PERMISSIONS.STUDY_DELETE],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when the user holds all required permissions', () => {
    const { guard, ctx } = ctxWith(
      { permissions: [PERMISSIONS.REPORT_SIGN, PERMISSIONS.REPORT_FINALIZE] },
      [PERMISSIONS.REPORT_SIGN],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies when a required permission is missing', () => {
    const { guard, ctx } = ctxWith(
      { permissions: [PERMISSIONS.WORKLIST_VIEW] },
      [PERMISSIONS.REPORT_SIGN],
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user', () => {
    const { guard, ctx } = ctxWith(undefined, [PERMISSIONS.WORKLIST_VIEW]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
