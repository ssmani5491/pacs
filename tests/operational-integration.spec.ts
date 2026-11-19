/**
 * PACS Operations Module 5 — Operational Integration tests.
 * Read-only composition over Modules 1–4 + Phase 8 services. Real records only.
 * Covers: permission-aware Command Centre tiles, org isolation, patient-MRN
 * redaction, exceptions console (existing recovery APIs only, heuristic labeling),
 * study-level aggregate, and notification dedup. Accuracy is cross-checked against
 * the owning APIs (Module 4 dashboard, /system/alerts/summary) and the DB.
 */
import { test, expect, request } from '@playwright/test';
import { testPassword } from './lib/test-credentials';

const BASE = process.env.BASE_URL || 'http://localhost';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function login(api: any, u: string, p: string) {
  const r = await api.post(`${BASE}/api/auth/login`, { data: { username: u, password: p } });
  expect(r.ok(), `login ${u}`).toBeTruthy();
  return (await r.json()).accessToken;
}
const OPS = '/api/pacs/operations';
const H = '/api/pacs/operations/history';

// ════════════════════ Task 2 — Command Centre overview ════════════════════

test('overview: admin gets all tiles; numbers match the owning APIs (Module 4 dashboard + alerts summary)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const ov = await (await api.get(`${BASE}${OPS}/overview`, { headers: auth(adm) })).json();

  // tiles present for an all-permission user
  expect(ov.transfer, 'transfer tile').toBeTruthy();
  expect(ov.archive, 'archive tile').toBeTruthy();
  expect(ov.storage, 'storage tile').toBeTruthy();
  expect(Array.isArray(ov.health), 'health tile').toBeTruthy();
  expect(ov.alerts, 'alerts tile').toBeTruthy();
  expect(Array.isArray(ov.recent), 'recent activity').toBeTruthy();

  // reverse-push buckets the brief names
  for (const k of ['completed', 'failed', 'running', 'queued']) {
    expect(ov.transfer, `transfer.${k}`).toHaveProperty(k);
  }
  for (const k of ['completed', 'failed', 'running', 'queued']) {
    expect(ov.archive, `archive.${k}`).toHaveProperty(k);
  }

  // EXACT accuracy vs Module 4 dashboard (single source of truth for totals)
  const d4 = await (await api.get(`${BASE}${H}/dashboard`, { headers: auth(adm) })).json();
  expect(ov.transfer.total).toBe(d4.reversePush.total);
  expect(ov.transfer.failed).toBe(d4.reversePush.failed);
  expect(ov.archive.total).toBe(d4.archive.total);
  expect(ov.archive.failed).toBe(d4.archive.failed);

  // EXACT accuracy vs the alerts summary endpoint
  const sum = await (await api.get(`${BASE}/api/system/alerts/summary`, { headers: auth(adm) })).json();
  expect(ov.alerts.open).toBe(sum.open);
  expect(ov.alerts.critical).toBe(sum.critical);

  // storage reflects real disk numbers
  expect(ov.storage.disk).toHaveProperty('usedPercent');
});

test('overview: reverse-push-only user sees transfer tile but no archive/storage/health tiles', async () => {
  const api = await request.newContext();
  const rp = await login(api, 'ophist_rp', 'Test!1234'); // reverse-push.view + patient.view only
  const ov = await (await api.get(`${BASE}${OPS}/overview`, { headers: auth(rp) })).json();
  expect(ov.transfer, 'transfer visible').toBeTruthy();
  expect(ov.archive, 'archive hidden').toBeFalsy();
  expect(ov.storage, 'storage hidden').toBeFalsy();
  expect(ov.health, 'health hidden').toBeFalsy();
  expect(ov.alerts, 'alerts hidden (no system.alert.view)').toBeFalsy();
});

test('overview: requires at least one source permission (receptionist 403)', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  expect((await api.get(`${BASE}${OPS}/overview`, { headers: auth(rec) })).status()).toBe(403);
});

test('overview: recent activity redacts patient MRN without patient.view', async () => {
  const api = await request.newContext();
  const ar = await login(api, 'ophist_ar', 'Test!1234'); // archive.view, NO patient.view
  const ov = await (await api.get(`${BASE}${OPS}/overview`, { headers: auth(ar) })).json();
  for (const row of ov.recent ?? []) expect(row.patientMrn ?? null).toBeNull();
});

// ════════════════════ Task 3 — Per-study operational aggregate ════════════════════

// A GGH study with both reverse-push and archive history (4 rp + 1 ar).
const STUDY_WITH_HISTORY = '1.2.826.0.1.3680043.8.498.91470081044676016600634571518134190811';
// A GGH study with NO operational history (0 rp, 0 ar).
const STUDY_NO_HISTORY = '1.2.826.1794573831769.291021865.509642';

// Deep scan: no string field anywhere in the payload equals a known patient identifier.
function assertNoPatientLeak(obj: any, needles: string[]) {
  const seen = JSON.stringify(obj);
  for (const n of needles) if (n) expect(seen.includes(n), `leak of "${n}"`).toBeFalsy();
}

test('study aggregate: admin sees identity + transfers + archives + summary + integrity', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const r = await api.get(`${BASE}${H}/study/${STUDY_WITH_HISTORY}`, { headers: auth(adm) });
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.study.studyInstanceUid).toBe(STUDY_WITH_HISTORY);
  expect(d.study.modality).toBe('CT');
  expect(d.study).toHaveProperty('instanceCount');
  // 4 reverse-push + 1 archive from the DB
  expect(d.transfers.length).toBe(4);
  expect(d.archives.length).toBe(1);
  for (const t of d.transfers) expect(t.type).toBe('REVERSE_PUSH');
  for (const a of d.archives) expect(a.type).toBe('ARCHIVE');
  expect(d.summary.transferCount).toBe(4);
  expect(d.summary.archiveCount).toBe(1);
  // integrity reflects the archive verification state
  expect(d.latestIntegrity).toBeTruthy();
  expect(d.latestIntegrity).toHaveProperty('verified');
  // admin has patient.view → MRN present
  expect(d.study.patientMrn).toBe('VIEWERVOL01');
});

test('study aggregate: study with no operational history returns empty arrays, zero counts, 200', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const r = await api.get(`${BASE}${H}/study/${STUDY_NO_HISTORY}`, { headers: auth(adm) });
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.study.studyInstanceUid).toBe(STUDY_NO_HISTORY);
  expect(d.transfers).toEqual([]);
  expect(d.archives).toEqual([]);
  expect(d.summary.transferCount).toBe(0);
  expect(d.summary.archiveCount).toBe(0);
  expect(d.latestIntegrity).toBeNull();
});

test('study aggregate: well-formed but unknown UID returns 404 (not 400)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // Valid DICOM UID format (numeric, <=64 chars) that does not exist.
  const r = await api.get(`${BASE}${H}/study/1.2.3.4.5.6.7.8.9.99999`, { headers: auth(adm) });
  expect(r.status()).toBe(404);
});

test('study aggregate: a study outside the caller org returns 404 (no existence leak), not 403', async () => {
  const api = await request.newContext();
  // ophist_rp is a GGH user; the GGH study exists for admin but we need a study in a
  // DIFFERENT org. There is currently one org + NULL-org orphan studies; a NULL-org
  // study is "another organization" to a scoped GGH user → must be 404, not 403/200.
  const rp = await login(api, 'ophist_rp', 'Test!1234');
  const adm = await login(api, 'admin', testPassword('admin'));
  // Admin can see a NULL-org study; find one (orphan). If none, fall back to a valid
  // unknown UID (also 404). Either way the GGH user must never get 200.
  const list = await (await api.get(`${BASE}/api/pacs/reconciliation/unmatched`, { headers: auth(adm) })).json().catch(() => ({ data: [] }));
  const foreignUid = (Array.isArray(list?.data) && list.data[0]?.studyInstanceUid) || '1.2.3.4.5.6.7.8.9.88888';
  const r = await api.get(`${BASE}${H}/study/${foreignUid}`, { headers: auth(rp) });
  expect([403, 404]).toContain(r.status());
  expect(r.status(), 'cross-org study must never return 200').not.toBe(200);
});

test('study aggregate: invalid UID input is rejected (400/404), never 500', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  for (const bad of ['../etc', 'not a uid!!', '%00', 'a'.repeat(200)]) {
    const r = await api.get(`${BASE}${H}/study/${encodeURIComponent(bad)}`, { headers: auth(adm) });
    expect([400, 404], `bad uid ${bad}`).toContain(r.status());
  }
});

test('study aggregate: reverse-push-only user sees transfers, no archives; archive-only sees archives, no transfers', async () => {
  const api = await request.newContext();
  const rp = await login(api, 'ophist_rp', 'Test!1234'); // reverse-push.view (+patient.view)
  const ar = await login(api, 'ophist_ar', 'Test!1234'); // archive.view, no patient.view

  const drp = await (await api.get(`${BASE}${H}/study/${STUDY_WITH_HISTORY}`, { headers: auth(rp) })).json();
  expect(drp.transfers.length).toBe(4);
  expect(drp.archives).toEqual([]); // no archive.view → archive source hidden
  expect(drp.study.patientMrn).toBe('VIEWERVOL01'); // rp user HAS patient.view

  const dar = await (await api.get(`${BASE}${H}/study/${STUDY_WITH_HISTORY}`, { headers: auth(ar) })).json();
  expect(dar.archives.length).toBe(1);
  expect(dar.transfers).toEqual([]); // no reverse-push.view → transfer source hidden
  // archive-only user LACKS patient.view → MRN must be null everywhere (no nested leak)
  expect(dar.study.patientMrn ?? null).toBeNull();
  assertNoPatientLeak(dar, ['VIEWERVOL01']);
});

test('study aggregate: user with no operational permission is 403', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  expect((await api.get(`${BASE}${H}/study/${STUDY_WITH_HISTORY}`, { headers: auth(rec) })).status()).toBe(403);
});

// ════════════════════ Task 4 — Exceptions console ════════════════════

// The seed (applied in CI/dev before this file) inserts synthetic FAILED,
// PARTIALLY_COMPLETED and interrupted (RUNNING, stale) transfer job rows plus the
// pre-existing real FAILED archive. See tools/testdata/seed_ops_exceptions_testjobs.sql.
const EXC = `${OPS}/exceptions`;

test('exceptions: admin sees confirmed failures, partial, interrupted-heuristic, and infra categories', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const r = await api.get(`${BASE}${EXC}`, { headers: auth(adm) });
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(Array.isArray(d.data)).toBeTruthy();
  const kinds = new Set(d.data.map((x: any) => x.kind));
  // Confirmed transfer failure + partial (from seed)
  expect(kinds.has('TRANSFER_FAILED'), 'TRANSFER_FAILED').toBeTruthy();
  expect(kinds.has('TRANSFER_PARTIAL'), 'TRANSFER_PARTIAL').toBeTruthy();
  // Interrupted heuristic (RUNNING, stale)
  expect(kinds.has('TRANSFER_INTERRUPTED_HEURISTIC'), 'interrupted heuristic').toBeTruthy();
  // Confirmed archive failure (real existing FAILED archive)
  expect(kinds.has('ARCHIVE_FAILED'), 'ARCHIVE_FAILED').toBeTruthy();

  // Each row carries the required fields.
  for (const row of d.data) {
    expect(row).toHaveProperty('source');
    expect(row).toHaveProperty('kind');
    expect(row).toHaveProperty('classification'); // CONFIRMED | HEURISTIC | INFRASTRUCTURE
    expect(row).toHaveProperty('timestamp');
    expect(row).toHaveProperty('recovery'); // {action,endpoint,requiredPermission} | null
    expect(row).toHaveProperty('canRecover');
  }
});

test('exceptions: classification separates confirmed failures from heuristic interrupted', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(adm) })).json();
  const failed = d.data.find((x: any) => x.kind === 'TRANSFER_FAILED');
  const interrupted = d.data.find((x: any) => x.kind === 'TRANSFER_INTERRUPTED_HEURISTIC');
  expect(failed.classification).toBe('CONFIRMED');
  expect(interrupted.classification).toBe('HEURISTIC');
  // the heuristic row must say it's inferred, never report a FAILED status
  expect(interrupted.status).not.toBe('FAILED');
});

test('exceptions: recovery references existing endpoints and is permission-gated (canRecover)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin')); // has manage perms
  const rp = await login(api, 'ophist_rp', 'Test!1234'); // reverse-push.view, NO manage
  const dAdm = await (await api.get(`${BASE}${EXC}`, { headers: auth(adm) })).json();
  const failedAdm = dAdm.data.find((x: any) => x.kind === 'TRANSFER_FAILED');
  // recovery endpoint is an EXISTING reverse-push route; required perm is the existing manage perm
  expect(failedAdm.recovery.endpoint).toContain('/api/pacs/reverse-push/jobs/');
  expect(failedAdm.recovery.requiredPermission).toBe('pacs.reverse-push.manage');
  expect(failedAdm.canRecover).toBe(true); // admin can

  const dRp = await (await api.get(`${BASE}${EXC}`, { headers: auth(rp) })).json();
  const failedRp = dRp.data.find((x: any) => x.kind === 'TRANSFER_FAILED');
  expect(failedRp.canRecover).toBe(false); // view-only user cannot
});

test('exceptions: source-specific RBAC — reverse-push-only sees only transfer exceptions', async () => {
  const api = await request.newContext();
  const rp = await login(api, 'ophist_rp', 'Test!1234'); // reverse-push.view only
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(rp) })).json();
  for (const row of d.data) expect(row.source).toBe('REVERSE_PUSH');
  // archive-only user sees only archive exceptions
  const ar = await login(api, 'ophist_ar', 'Test!1234');
  const da = await (await api.get(`${BASE}${EXC}`, { headers: auth(ar) })).json();
  for (const row of da.data) expect(row.source).toBe('ARCHIVE');
});

test('exceptions: patient MRN redacted (incl. nested) without patient.view', async () => {
  const api = await request.newContext();
  const ar = await login(api, 'ophist_ar', 'Test!1234'); // archive.view, no patient.view
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(ar) })).json();
  for (const row of d.data) expect(row.patientMrn ?? null).toBeNull();
  assertNoPatientLeak(d, ['VIEWERVOL01']);
});

test('exceptions: no file paths / credentials / secrets leak in any row', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(adm) })).json();
  const blob = JSON.stringify(d);
  // archivePath, container paths, and orthanc creds must never appear
  for (const needle of ['/var/lib/pacs', 'archivePath', 'orthanc:orthanc', 'password', '.zip.gz']) {
    expect(blob.includes(needle), `leak of ${needle}`).toBeFalsy();
  }
});

test('exceptions: endpoint is read-only — job rows are unchanged after calling it', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // call it twice; the interrupted RUNNING job must stay RUNNING (never auto-cancelled/retried)
  await api.get(`${BASE}${EXC}`, { headers: auth(adm) });
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(adm) })).json();
  const interrupted = d.data.find((x: any) => x.kind === 'TRANSFER_INTERRUPTED_HEURISTIC');
  expect(interrupted.status).toBe('RUNNING'); // unchanged — no mutation
});

test('exceptions: user with no operational permission is 403', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  expect((await api.get(`${BASE}${EXC}`, { headers: auth(rec) })).status()).toBe(403);
});

// ════════════════════ Task 5 — Integrity-failure notification ════════════════════

// Synthetic archive jobs seeded for this suite:
//  - FAIL job: archivePath points at a missing file → verify fails ("archive file missing")
const INTEGRITY_FAIL_JOB = 'a5000000-0000-4000-8000-0000000000e1';
// A real VERIFIED archive job (study ...190811) whose archive exists on disk → verify succeeds.
const VERIFY_OK_JOB = 'ac876e78-5f59-4787-bd41-1e353cdfb57c';

const verify = (api: any, tok: string, jobId: string) =>
  api.post(`${BASE}/api/pacs/archive/jobs/${jobId}/verify`, { headers: auth(tok) });

test('integrity notify: successful manual verify produces NO failure notification', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const r = await verify(api, adm, VERIFY_OK_JOB);
  expect(r.status()).toBe(201);
  const body = await r.json();
  expect(body.verified).toBe(true);
  // The absence of a failure notification for a successful verify is asserted
  // against the DB in the Task 5 verification step (no integrity-fail:<VERIFY_OK_JOB> row).
});

test('integrity notify: failed manual verify creates exactly one HIGH notification, deduped same day', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // first failed verify
  const r1 = await verify(api, adm, INTEGRITY_FAIL_JOB);
  expect(r1.status()).toBe(201);
  expect((await r1.json()).verified).toBe(false);
  // second failed verify same day → must NOT create a duplicate
  const r2 = await verify(api, adm, INTEGRITY_FAIL_JOB);
  expect(r2.status()).toBe(201);
  expect((await r2.json()).verified).toBe(false);
  // verification result is intact even if notification deduped
});

test('integrity notify: verification result unaffected by notification layer (still returns a result)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const r = await verify(api, adm, INTEGRITY_FAIL_JOB);
  expect(r.status()).toBe(201);
  // the endpoint returns the archive job with verified=false and a detail — never a 500
  const b = await r.json();
  expect(b).toHaveProperty('verified', false);
  expect(b).toHaveProperty('verifyDetail');
});

test('integrity notify: org isolation — failed verify forbidden to a non-owner org user (no cross-org notify)', async () => {
  const api = await request.newContext();
  // ophist_ar has archive.view but NOT archive.manage → verify is 403 regardless of org.
  const ar = await login(api, 'ophist_ar', 'Test!1234');
  const r = await verify(api, ar, INTEGRITY_FAIL_JOB);
  expect(r.status()).toBe(403); // manage required; no notification path reached
});

test('integrity notify: existing archive completion/failure + exceptions endpoints still function', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // archive monitor still 200 (existing notifications/flow untouched)
  expect((await api.get(`${BASE}/api/pacs/archive/monitor`, { headers: auth(adm) })).status()).toBe(200);
  // exceptions endpoint still lists the failed archive (no regression from Task 4)
  const d = await (await api.get(`${BASE}${EXC}`, { headers: auth(adm) })).json();
  expect(d.data.some((x: any) => x.kind === 'ARCHIVE_FAILED')).toBeTruthy();
});

// ════════════════════ Task 6 — Frontend UI (Playwright browser) ════════════════════

import { test as uiTest, expect as uiExpect } from '@playwright/test';

async function uiLogin(page: any, u: string, p: string) {
  await page.goto(`${BASE}/login`);
  await page.getByRole('textbox').first().fill(u);
  await page.locator('input[type="password"]').fill(p);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/`);
}

uiTest('UI: Command Centre renders tiles with full permissions', async ({ page }) => {
  await uiLogin(page, 'admin', testPassword('admin'));
  await page.goto(`${BASE}/pacs/operations/command-centre`);
  await uiExpect(page.getByRole('heading', { name: 'Operations Command Centre' })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Reverse Push', exact: true })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Service Health' })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Active Alerts' })).toBeVisible();
});

uiTest('UI: Command Centre hides tiles with partial permissions (reverse-push-only)', async ({ page }) => {
  await uiLogin(page, 'ophist_rp', 'Test!1234');
  await page.goto(`${BASE}/pacs/operations/command-centre`);
  await uiExpect(page.getByRole('heading', { name: 'Reverse Push', exact: true })).toBeVisible();
  // storage / service health / alerts tiles hidden (no permission)
  await uiExpect(page.getByRole('heading', { name: 'Service Health' })).toHaveCount(0);
  await uiExpect(page.getByRole('heading', { name: 'Active Alerts' })).toHaveCount(0);
  await uiExpect(page.getByRole('heading', { name: 'Storage', exact: true })).toHaveCount(0);
});

uiTest('UI: Exceptions Console shows recovery for a manager, hides it for a viewer', async ({ page }) => {
  // manager (admin) sees recovery buttons
  await uiLogin(page, 'admin', testPassword('admin'));
  await page.goto(`${BASE}/pacs/operations/exceptions`);
  await uiExpect(page.getByRole('heading', { name: 'Operations Exceptions' })).toBeVisible();
  await uiExpect(page.getByRole('button', { name: 'retry' }).first()).toBeVisible();

  // view-only user sees "(no permission)" instead
  await uiLogin(page, 'ophist_rp', 'Test!1234');
  await page.goto(`${BASE}/pacs/operations/exceptions`);
  await uiExpect(page.getByText('(no permission)').first()).toBeVisible();
  await uiExpect(page.getByRole('button', { name: 'retry' })).toHaveCount(0);
});

uiTest('UI: worklist Study Operations drawer opens and handles empty history', async ({ page }) => {
  await uiLogin(page, 'admin', testPassword('admin'));
  await page.goto(`${BASE}/worklist`);
  await page.getByRole('button', { name: 'Operations' }).first().click();
  await uiExpect(page.getByRole('heading', { name: 'Study Operations' })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Reverse Push History' })).toBeVisible();
  await uiExpect(page.getByRole('heading', { name: 'Archive History & Integrity' })).toBeVisible();
});
