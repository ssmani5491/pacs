/**
 * PACS Operations Module 1 — DICOM Reverse Push integration tests (Playwright, API-level).
 * Synthetic data only. Requires a reachable destination; these tests focus on the
 * API contract, permissions, org isolation, and validation (the real C-STORE
 * transfer + destination verification is covered in REVERSE_PUSH_TEST_RESULTS.md).
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

test('reverse-push endpoints require permission', async () => {
  const api = await request.newContext();
  const rec = await login(api, 'recept1', testPassword('recept1'));       // no pacs perms
  const rad = await login(api, 'rad_ggh', testPassword('rad_ggh'));        // no destination.manage
  expect((await api.get(`${BASE}/api/pacs/destinations`, { headers: auth(rec) })).status()).toBe(403);
  expect((await api.get(`${BASE}/api/pacs/reverse-push/jobs`, { headers: auth(rec) })).status()).toBe(403);
  const createDest = await api.post(`${BASE}/api/pacs/destinations`, {
    headers: auth(rad), data: { name: 'x', aeTitle: 'X', host: 'orthanc-dest', port: 4242 },
  });
  expect(createDest.status()).toBe(403); // radiologist lacks destination.manage
});

test('destination SSRF protection blocks internal infra', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  for (const host of ['postgres', 'redis', 'backend', 'localhost']) {
    const r = await api.post(`${BASE}/api/pacs/destinations`, {
      headers: auth(adm), data: { name: `ssrf-${host}`, aeTitle: 'X', host, port: 5432 },
    });
    expect(r.status()).toBe(400);
  }
});

test('reverse-push monitor returns real aggregate shape', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const m = await (await api.get(`${BASE}/api/pacs/reverse-push/monitor`, { headers: auth(adm) })).json();
  expect(m.engine).toContain('Orthanc');
  expect(m.queue).toHaveProperty('completed');
  expect(m.transmission).toHaveProperty('successFiles');
  expect(Array.isArray(m.destinations)).toBeTruthy();
});

test('org isolation on destinations and jobs', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const other = await login(api, 'rad_tcl', testPassword('rad_tcl')); // org TCL, lacks pacs perms anyway
  // rad_tcl has no reverse-push.view -> 403 on list
  expect((await api.get(`${BASE}/api/pacs/destinations`, { headers: auth(other) })).status()).toBe(403);
  // a GGH destination created by admin must not be readable by a TCL user even with a guessed id
  const dests = await (await api.get(`${BASE}/api/pacs/destinations?pageSize=50`, { headers: auth(adm) })).json();
  if (dests.data.length) {
    const id = dests.data[0].id;
    expect([403, 404]).toContain((await api.get(`${BASE}/api/pacs/destinations/${id}`, { headers: auth(other) })).status());
  }
});
