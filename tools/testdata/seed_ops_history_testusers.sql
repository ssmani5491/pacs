-- Synthetic test users for PACS Operations Module 4 (Transfer & Archive History).
-- Creates two minimal roles each carrying exactly ONE source-view permission, and
-- a user for each, so per-source visibility can be proven with a real JWT.
-- ADDITIVE ONLY: inserts test_* rows; never deletes or modifies existing data.
-- Idempotent (ON CONFLICT DO NOTHING / upsert). password for both = Test!1234
-- (argon2id hash below is the same hash seeded for other Test!1234 users).

-- Resolve the argon2id hash for Test!1234 from an existing test user so we don't embed a raw hash.
DO $$
DECLARE
  h text;
  org text;
  rp_role uuid;
  ar_role uuid;
  perm_rp uuid;
  perm_ar uuid;
  perm_pv uuid;
  u_rp uuid;
  u_ar uuid;
BEGIN
  SELECT "passwordHash" INTO h FROM users WHERE username = 'rad_ggh' LIMIT 1;
  SELECT "organizationId" INTO org FROM users WHERE username = 'rad_ggh' LIMIT 1;
  IF h IS NULL THEN RAISE NOTICE 'rad_ggh not found; aborting test-user seed'; RETURN; END IF;

  SELECT id INTO perm_rp FROM permissions WHERE key = 'pacs.reverse-push.view' LIMIT 1;
  SELECT id INTO perm_ar FROM permissions WHERE key = 'pacs.archive.view' LIMIT 1;
  SELECT id INTO perm_pv FROM permissions WHERE key = 'patient.view' LIMIT 1;

  -- Roles
  INSERT INTO roles (id, key, name, description, system)
  VALUES (gen_random_uuid(), 'test_rp_only', 'Test Reverse-Push Only', 'Module 4 test role', false)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO roles (id, key, name, description, system)
  VALUES (gen_random_uuid(), 'test_ar_only', 'Test Archive Only', 'Module 4 test role', false)
  ON CONFLICT (key) DO NOTHING;
  SELECT id INTO rp_role FROM roles WHERE key = 'test_rp_only';
  SELECT id INTO ar_role FROM roles WHERE key = 'test_ar_only';

  -- Role permissions: rp_only gets reverse-push.view + patient.view; ar_only gets archive.view (NO patient.view, to test redaction)
  IF perm_rp IS NOT NULL THEN INSERT INTO role_permissions ("roleId","permissionId") VALUES (rp_role, perm_rp) ON CONFLICT DO NOTHING; END IF;
  IF perm_pv IS NOT NULL THEN INSERT INTO role_permissions ("roleId","permissionId") VALUES (rp_role, perm_pv) ON CONFLICT DO NOTHING; END IF;
  IF perm_ar IS NOT NULL THEN INSERT INTO role_permissions ("roleId","permissionId") VALUES (ar_role, perm_ar) ON CONFLICT DO NOTHING; END IF;

  -- Users (same org as rad_ggh so org-isolation stays valid). Super-admin is role-derived, no column.
  INSERT INTO users (id, username, email, "passwordHash", "organizationId", active, "fullName", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'ophist_rp', 'ophist_rp@test.local', h, org, true, 'Ops History RP Tester', now(), now())
  ON CONFLICT (username) DO NOTHING;
  INSERT INTO users (id, username, email, "passwordHash", "organizationId", active, "fullName", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'ophist_ar', 'ophist_ar@test.local', h, org, true, 'Ops History AR Tester', now(), now())
  ON CONFLICT (username) DO NOTHING;
  SELECT id INTO u_rp FROM users WHERE username = 'ophist_rp';
  SELECT id INTO u_ar FROM users WHERE username = 'ophist_ar';

  INSERT INTO user_roles ("userId","roleId") VALUES (u_rp, rp_role) ON CONFLICT DO NOTHING;
  INSERT INTO user_roles ("userId","roleId") VALUES (u_ar, ar_role) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'ops-history test users seeded: ophist_rp (reverse-push+patient), ophist_ar (archive only)';
END $$;
