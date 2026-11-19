import { AuthUser } from '../auth/current-user.decorator';

/**
 * Returns a Prisma `where` fragment enforcing organization isolation.
 * - super_admin: no restriction (sees all orgs)
 * - everyone else: restricted to their own organizationId
 * Used on tenant-scoped entities (departments, doctors, users, modalities, ...).
 */
export function orgScope(user: AuthUser): Record<string, unknown> {
  if (user.isSuperAdmin) return {};
  return { organizationId: user.organizationId ?? '__none__' };
}

/**
 * For entities where the org is the record itself (Organization):
 * super_admin sees all; an org-scoped user sees only their own org row.
 */
export function orgSelfScope(user: AuthUser): Record<string, unknown> {
  if (user.isSuperAdmin) return {};
  return { id: user.organizationId ?? '__none__' };
}

/** Guard: a non-super user may only write within their own organization. */
export function assertOrgWriteAllowed(user: AuthUser, targetOrgId?: string | null) {
  if (user.isSuperAdmin) return;
  if (!targetOrgId || targetOrgId !== user.organizationId) {
    throw new Error('Cross-organization write denied');
  }
}
