/**
 * PACS Operations Module 2 — Archive Compression integration tests (Playwright, API).
 * Synthetic data only. The real compression + checksum + extraction are covered in
 * PACS_ARCHIVE_TEST_RESULTS.md; these cover the API contract, permissions, isolation.
 */
import { test, expect, request } from '@playwright/test';
import { testPassword } from './lib/test-credentials';

const BASE = process.env.BASE_URL || 'http://localhost';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
async function login(api, u, p) {
  const r = await api.post(`${BASE}/api/auth/login`, { data: { username: u, password: p } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).accessToken;
}

test('archive endpoints require permission', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));
  const rad = await login(api, 'rad_ggh', testPassword('rad_ggh'));
  expect((await api.get(`${BASE}/api/pacs/archive/monitor`, { headers: auth(rec) })).status()).toBe(403);
  expect((await api.get(`${BASE}/api/pacs/archive/jobs`, { headers: auth(rec) })).status()).toBe(403);
  const create = await api.post(`${BASE}/api/pacs/archive/jobs`, { headers: auth(rad), data: { studyInstanceUid: 'x' } });
  expect(create.status()).toBe(403); // radiologist lacks archive.manage
});

test('archive monitor returns real aggregate shape', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const m = await (await api.get(`${BASE}/api/pacs/archive/monitor`, { headers: auth(adm) })).json();
  expect(m.queue).toHaveProperty('verified');
  expect(m.storage).toHaveProperty('overallSavingsPercent');
  expect(m.config).toHaveProperty('defaultCompressionLevel');
});

test('completed archive job is verified (sha256 + extraction)', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const jobs = await (await api.get(`${BASE}/api/pacs/archive/jobs?pageSize=25`, { headers: auth(adm) })).json();
  const verified = jobs.data.find((j) => j.status === 'VERIFIED');
  expect(verified).toBeTruthy();
  expect(verified.verified).toBe(true);
  expect(verified.sha256).toBeTruthy();
  expect(verified.compressedBytes).toBeLessThan(verified.originalBytes); // real savings
});

test('archive org isolation', async () => {
  const api = await request.newContext();
  const other = await login(api, 'rad_tcl', testPassword('rad_tcl'));
  expect((await api.get(`${BASE}/api/pacs/archive/jobs`, { headers: auth(other) })).status()).toBe(403);
});
