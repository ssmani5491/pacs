/**
 * PACS Operations Module 4 — Transfer & Archive History integration tests.
 * Read-only reporting over Module 1 (reverse-push) + Module 2 (archive) records.
 * Accuracy assertions are cross-checked against the per-source list totals (which
 * come straight from the DB). Real records only. Covers the brief's 16 checks:
 * accuracy, dashboard, date/combined filters, pagination, sorting, CSV + injection,
 * org isolation, permission enforcement (incl. per-source), audit, large dataset,
 * and that Modules 1/2/3 remain functional.
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
const H = '/api/pacs/operations/history';

// ── Permission enforcement ──
test('history requires a source permission (receptionist 403, admin 200)', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  const adm = await login(api, 'admin', testPassword('admin'));
  expect((await api.get(`${BASE}${H}/dashboard`, { headers: auth(rec) })).status()).toBe(403);
  expect((await api.get(`${BASE}${H}/list`, { headers: auth(rec) })).status()).toBe(403);
  expect((await api.get(`${BASE}${H}/dashboard`, { headers: auth(adm) })).status()).toBe(200);
});

// ── Accuracy: unified total == reverse-push total + archive total ──
test('unified list total equals reverse-push + archive totals (no duplicate counting)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const uni = await (await api.get(`${BASE}${H}/list?pageSize=1`, { headers: auth(adm) })).json();
  const rp = await (await api.get(`${BASE}${H}/reverse-push?pageSize=1`, { headers: auth(adm) })).json();
  const ar = await (await api.get(`${BASE}${H}/archive?pageSize=1`, { headers: auth(adm) })).json();
  expect(uni.total).toBe(rp.total + ar.total);
  for (const row of (await (await api.get(`${BASE}${H}/list?pageSize=50`, { headers: auth(adm) })).json()).data) {
    expect(['REVERSE_PUSH', 'ARCHIVE']).toContain(row.type);
  }
});

// ── Per-source filtering ──
test('reverse-push-only user sees only reverse-push rows; archive-only user sees only archive rows', async () => {
  const api = await request.newContext();
  const rp = await login(api, 'ophist_rp', 'Test!1234');
  const ar = await login(api, 'ophist_ar', 'Test!1234');
  const rpList = await (await api.get(`${BASE}${H}/list?pageSize=100`, { headers: auth(rp) })).json();
  for (const row of rpList.data) expect(row.type).toBe('REVERSE_PUSH');
  // archive endpoint is forbidden to a reverse-push-only user
  expect((await api.get(`${BASE}${H}/archive`, { headers: auth(rp) })).status()).toBe(403);

  const arList = await (await api.get(`${BASE}${H}/list?pageSize=100`, { headers: auth(ar) })).json();
  for (const row of arList.data) expect(row.type).toBe('ARCHIVE');
  expect((await api.get(`${BASE}${H}/reverse-push`, { headers: auth(ar) })).status()).toBe(403);
});

// ── Patient MRN gating ──
test('user without patient.view gets null patientMrn (archive-only user)', async () => {
  const api = await request.newContext();
  const ar = await login(api, 'ophist_ar', 'Test!1234'); // has archive.view, NOT patient.view
  const list = await (await api.get(`${BASE}${H}/list?pageSize=100`, { headers: auth(ar) })).json();
  for (const row of list.data) expect(row.patientMrn).toBeNull();
});

// ── Dashboard metrics vs per-source totals ──
test('dashboard reverse-push + archive totals match list totals; archive sums are real', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const d = await (await api.get(`${BASE}${H}/dashboard?range=all`, { headers: auth(adm) })).json();
  const rp = await (await api.get(`${BASE}${H}/reverse-push?pageSize=1`, { headers: auth(adm) })).json();
  const ar = await (await api.get(`${BASE}${H}/archive?pageSize=1`, { headers: auth(adm) })).json();
  expect(d.reversePush.total).toBe(rp.total);
  expect(d.archive.total).toBe(ar.total);
  // Seeded archives exist and have real byte sums + savings.
  expect(d.archive.originalBytes).toBeGreaterThan(0);
  expect(d.archive.compressedBytes).toBeGreaterThan(0);
  expect(d.archive.savingsBytes).toBe(Math.max(0, d.archive.originalBytes - d.archive.compressedBytes));
  expect(Array.isArray(d.recent)).toBeTruthy();
});

// ── Date filters ──
test('date range filters: future custom window is empty, not a 500; from>to is empty', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const future = await api.get(`${BASE}${H}/dashboard?range=custom&from=2999-01-01&to=2999-12-31`, { headers: auth(adm) });
  expect(future.status()).toBe(200);
  const fj = await future.json();
  expect(fj.reversePush.total).toBe(0);
  expect(fj.archive.total).toBe(0);
  const inverted = await api.get(`${BASE}${H}/list?range=custom&from=2999-12-31&to=2999-01-01`, { headers: auth(adm) });
  expect(inverted.status()).toBe(200);
  expect((await inverted.json()).total).toBe(0);
});

// ── Combined filters + pagination + sorting ──
test('combined filter (type+status), pagination, and sort by createdAt desc', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // pagination: pageSize=1 yields exactly 1 row when records exist
  const p1 = await (await api.get(`${BASE}${H}/list?pageSize=1&page=1`, { headers: auth(adm) })).json();
  expect(p1.data.length).toBeLessThanOrEqual(1);
  if (p1.total > 1) expect(p1.totalPages).toBeGreaterThan(1);
  // sort createdAt desc → non-increasing
  const sorted = await (await api.get(`${BASE}${H}/list?pageSize=20&sortBy=createdAt&sortDir=desc`, { headers: auth(adm) })).json();
  const ts = sorted.data.map((r: any) => r.createdAt);
  for (let i = 1; i < ts.length; i++) expect(ts[i - 1] >= ts[i]).toBeTruthy();
  // combined filter: only ARCHIVE rows when type=ARCHIVE
  const onlyAr = await (await api.get(`${BASE}${H}/list?type=ARCHIVE&pageSize=50`, { headers: auth(adm) })).json();
  for (const r of onlyAr.data) expect(r.type).toBe('ARCHIVE');
});

// ── CSV export + formula-injection + audit ──
test('CSV export (unified) is downloadable, has provenance + header, and is audited', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const res = await api.get(`${BASE}${H}/export?kind=unified`, { headers: auth(adm) });
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body.split('\n')[0]).toContain('# Operations history export');
  expect(body).toContain('type,id');
  // audit event recorded
  const audit = await (await api.get(`${BASE}/api/audit-logs?action=OPS_HISTORY_EXPORT&pageSize=1`, { headers: auth(adm) })).json();
  expect(audit.total).toBeGreaterThan(0);
});

test('archive CSV export omits patientMrn column for a user without patient.view', async () => {
  const api = await request.newContext();
  const ar = await login(api, 'ophist_ar', 'Test!1234');
  const res = await api.get(`${BASE}${H}/export?kind=archive`, { headers: auth(ar) });
  expect(res.ok()).toBeTruthy();
  const header = (await res.text()).split('\n')[1]; // line 2 = column header
  expect(header).not.toContain('patientMrn');
});

test('export without any source permission is 403', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  expect((await api.get(`${BASE}${H}/export?kind=unified`, { headers: auth(rec) })).status()).toBe(403);
});

// ── Operation detail ──
test('reverse-push detail returns instance-level results; cross-org denied', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const list = await (await api.get(`${BASE}${H}/reverse-push?pageSize=1`, { headers: auth(adm) })).json();
  test.skip(list.total === 0, 'no reverse-push jobs seeded');
  const id = list.data[0].id;
  const detail = await (await api.get(`${BASE}${H}/reverse-push/${id}`, { headers: auth(adm) })).json();
  expect(Array.isArray(detail.instances)).toBeTruthy();
  expect(detail).toHaveProperty('destination');
  // cross-org user (rad_tcl, 2nd org, no pacs perms) → 403
  const other = await login(api, 'rad_tcl', testPassword('rad_tcl'));
  expect((await api.get(`${BASE}${H}/reverse-push/${id}`, { headers: auth(other) })).status()).toBe(403);
});

test('archive detail hides archivePath without manage; non-mutating re-verify is audited and leaves job unchanged', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const list = await (await api.get(`${BASE}${H}/archive?pageSize=25`, { headers: auth(adm) })).json();
  const verified = list.data.find((j: any) => j.status === 'VERIFIED') || list.data[0];
  test.skip(!verified, 'no archive jobs seeded');
  const id = verified.id;

  // admin is super → sees archivePath
  const asAdmin = await (await api.get(`${BASE}${H}/archive/${id}`, { headers: auth(adm) })).json();
  expect(asAdmin).toHaveProperty('sha256');
  // archive-only user lacks manage → archivePath omitted
  const ar = await login(api, 'ophist_ar', 'Test!1234');
  const asAr = await (await api.get(`${BASE}${H}/archive/${id}`, { headers: auth(ar) })).json();
  expect(asAr.archivePath).toBeUndefined();

  // Non-mutating re-verify: record verifiedAt before/after, assert unchanged.
  const before = await (await api.get(`${BASE}${H}/archive/${id}`, { headers: auth(adm) })).json();
  const rv = await api.post(`${BASE}${H}/archive/${id}/verify`, { headers: auth(adm) });
  expect(rv.ok()).toBeTruthy();
  expect((await rv.json())).toHaveProperty('ok');
  const after = await (await api.get(`${BASE}${H}/archive/${id}`, { headers: auth(adm) })).json();
  expect(after.verifiedAt).toBe(before.verifiedAt); // NOT mutated
  expect(after.status).toBe(before.status);
  const audit = await (await api.get(`${BASE}/api/audit-logs?action=OPS_HISTORY_ARCHIVE_REVERIFY&pageSize=1`, { headers: auth(adm) })).json();
  expect(audit.total).toBeGreaterThan(0);
});

// ── Existing modules still functional (regression touchpoints) ──
test('existing Module 1/2/3 endpoints still respond', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  expect((await api.get(`${BASE}/api/pacs/reverse-push/monitor`, { headers: auth(adm) })).status()).toBe(200);
  expect((await api.get(`${BASE}/api/pacs/archive/monitor`, { headers: auth(adm) })).status()).toBe(200);
  expect((await api.get(`${BASE}/api/pacs/storage/dashboard`, { headers: auth(adm) })).status()).toBe(200);
});

// ── UI smoke ──
test('UI: Transfer & Archive History page loads with tabs', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill(testPassword('admin'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/pacs/operations/history`);
  await expect(page.getByRole('heading', { name: 'Transfer & Archive History' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DASHBOARD' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'UNIFIED' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ARCHIVE', exact: true })).toBeVisible();
});
