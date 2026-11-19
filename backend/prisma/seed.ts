// Seeds roles, permissions, the GG Hospital organization, and a super admin.
// Synthetic/config data only — NO patient data here.
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLES, ALL_PERMISSIONS } from '../src/rbac/permissions';

const prisma = new PrismaClient();

/**
 * F-02 Step 4: reject a missing or weak SEED_ADMIN_PASSWORD before a fresh
 * administrator account is created. Policy matches the rest of the application
 * EXACTLY (ChangePasswordDto.newPassword / ResetPasswordDto.newPassword /
 * CreateUserDto.password all use class-validator's @MinLength(8), nothing
 * stricter) — this does not introduce a second, conflicting password policy.
 * Never includes the password or any hash in its error message.
 */
function assertStrongSeedPassword(password: string | undefined, username: string): asserts password is string {
  if (!password || password.length === 0) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is not set. A fresh administrator account ('${username}') must be ` +
      `created with an explicit, strong password — there is no default. Set SEED_ADMIN_PASSWORD ` +
      `(at least 8 characters) in your environment before seeding. This check does not run when ` +
      `the account already exists.`,
    );
  }
  if (password.length < 8) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is too short (minimum 8 characters, matching the application's existing ` +
      `password policy). Refusing to create the administrator account ('${username}') with a weak password.`,
    );
  }
}

async function main() {
  // Permissions
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  // Roles + role-permission links
  for (const [key, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: def.name },
      create: { key, name: def.name, system: true },
    });
    for (const permKey of def.permissions) {
      const perm = await prisma.permission.findUnique({ where: { key: permKey } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // Organization
  const org = await prisma.organization.upsert({
    where: { code: 'GGH' },
    update: {},
    create: { code: 'GGH', name: 'GG Hospital', active: true },
  });

  // Super admin
  // ── F-02 Step 4: no hardcoded/default password. ──────────────────────────
  // The password (and the policy check on it) is needed ONLY when the admin
  // account does not exist yet — an existing admin's row and password are
  // NEVER touched by this seed (upsert below uses update: {}), so a normal
  // restart of an already-seeded deployment never evaluates SEED_ADMIN_PASSWORD
  // at all and cannot fail because of it (preserves safe normal startup).
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.local';

  const existingAdmin = await prisma.user.findUnique({ where: { username } });

  // Two genuinely different operations, not one upsert with a fake branch:
  // an existing admin is read-only here (no update call at all — nothing to
  // silently reset); a fresh admin is validated, hashed, and created.
  let admin: { id: string };
  if (existingAdmin) {
    admin = existingAdmin;
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD;
    assertStrongSeedPassword(password, username);
    const pepper = process.env.PASSWORD_PEPPER ?? '';
    const passwordHash = await argon2.hash(password + pepper, { type: argon2.argon2id });
    admin = await prisma.user.create({
      data: {
        username,
        fullName: 'System Administrator',
        email,
        passwordHash,
        active: true,
        organizationId: org.id,
      },
    });
  }

  const superRole = await prisma.role.findUnique({ where: { key: 'super_admin' } });
  if (superRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
      update: {},
      create: { userId: admin.id, roleId: superRole.id },
    });
  }

  // Phase 7 — seed a few report templates (idempotent by code within org).
  const templates = [
    {
      code: 'CT-HEAD-NORMAL', name: 'CT Head — Normal', modalityType: 'CT',
      technique: 'Axial non-contrast CT images of the brain were obtained.',
      bodyFindings: 'The ventricles and sulci are normal in size and configuration for age. No intra- or extra-axial haemorrhage, mass effect, or midline shift. Grey-white differentiation is preserved. No acute territorial infarct. The visualised paranasal sinuses and mastoid air cells are clear.',
      bodyImpression: 'Normal CT of the brain. No acute intracranial abnormality.',
      bodyRecommendations: 'Clinical correlation. No follow-up imaging required unless clinically indicated.',
    },
    {
      code: 'CT-CHEST', name: 'CT Chest', modalityType: 'CT',
      technique: 'Volumetric CT of the chest was performed.',
      bodyFindings: 'Lungs: \nMediastinum: \nPleura: \nChest wall: ',
      bodyImpression: '',
      bodyRecommendations: '',
    },
    {
      code: 'MR-BRAIN', name: 'MRI Brain', modalityType: 'MR',
      technique: 'Multiplanar multisequence MRI of the brain.',
      bodyFindings: '', bodyImpression: '', bodyRecommendations: '',
    },
    {
      code: 'XR-CHEST', name: 'Chest X-ray', modalityType: 'CR',
      technique: 'PA (and lateral where available) chest radiograph.',
      bodyFindings: 'Heart size normal. Clear lung fields. No pleural effusion or pneumothorax. No focal consolidation.',
      bodyImpression: 'Normal chest radiograph.',
      bodyRecommendations: '',
    },
  ];
  for (const t of templates) {
    const existing = await prisma.reportTemplate.findFirst({ where: { code: t.code, organizationId: org.id } });
    if (!existing) {
      await prisma.reportTemplate.create({ data: { ...t, organizationId: org.id, active: true } });
    }
  }

  console.log(
    existingAdmin
      ? `Seed complete. Org=${org.code}, admin user='${username}' already existed — password/role/org/active status unchanged.`
      : `Seed complete. Org=${org.code}, admin user='${username}' created with the operator-supplied SEED_ADMIN_PASSWORD.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
