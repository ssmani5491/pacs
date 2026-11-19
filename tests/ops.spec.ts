/**
 * Phase 8 — notifications / audit / ops integration tests (Playwright, API-level).
 * Synthetic data only. Assumes fixtures: admin, rad_ggh (GGH), rad_tcl (TCL).
 *
 * Run: BASE_URL=http://localhost npx playwright test tests/ops.spec.ts
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

test('notification generated from a real assign event + org isolation', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // find rad_ggh id + an assignable GGH order
  const users = await (await api.get(`${BASE}/api/users?pageSize=200`, { headers: auth(adm) })).json();
  const radId = users.data.find((u) => u.username === 'rad_ggh').id;
  const orders = await (await api.get(`${BASE}/api/orders?pageSize=5`, { headers: auth(adm) })).json();
  const orderId = orders.data[3]?.id ?? orders.data[0].id;

  await api.patch(`${BASE}/api/orders/${orderId}/assign`, { headers: auth(adm), data: { assignedUserId: radId } });

  // Filter by category (existing, supported API filter) and assert on THIS
  // order's notification specifically, by orderId — not merely "some
  // EXAM_ASSIGNED notification exists on page 1". The assign notification is
  // deduped server-side per (orderId, assignedUserId) (orders.service.ts:117),
  // so repeated test runs against the same order never create a fresh one; its
  // single row can sink arbitrarily far down an unfiltered, unpaginated default
  // list as other tests generate newer notifications. Filtering by category AND
  // matching orderId makes the assertion immune to that accumulation while
  // staying STRICTLY STRONGER than the original check (it proves the
  // notification belongs to *this* assignment, not merely that some
  // EXAM_ASSIGNED notification happens to exist for the recipient).
  const rad = await login(api, 'rad_ggh', testPassword('rad_ggh'));
  const notifs = await (await api.get(`${BASE}/api/notifications?category=EXAM_ASSIGNED&pageSize=100`, { headers: auth(rad) })).json();
  expect(notifs.total).toBeGreaterThan(0);
  expect(notifs.data.some((n) => n.category === 'EXAM_ASSIGNED' && n.orderId === orderId)).toBeTruthy();

  // other-org radiologist sees none of GGH's EXAM_ASSIGNED notifications (org isolation,
  // scoped the same way as the positive check above so this stays deterministic too).
  const tcl = await login(api, 'rad_tcl', testPassword('rad_tcl'));
  const tclNotifs = await (await api.get(`${BASE}/api/notifications?category=EXAM_ASSIGNED&pageSize=100`, { headers: auth(tcl) })).json();
  expect(tclNotifs.data.some((n) => n.orderId === orderId)).toBeFalsy();
});

test('notification read flow updates unread count', async () => {
  const api = await request.newContext();
  const rad = await login(api, 'rad_ggh', testPassword('rad_ggh'));
  const list = await (await api.get(`${BASE}/api/notifications?read=false`, { headers: auth(rad) })).json();
  if (list.total === 0) return; // nothing unread; skip
  const id = list.data[0].id;
  const before = (await (await api.get(`${BASE}/api/notifications/unread-count`, { headers: auth(rad) })).json()).count;
  await api.patch(`${BASE}/api/notifications/${id}/read`, { headers: auth(rad) });
  const after = (await (await api.get(`${BASE}/api/notifications/unread-count`, { headers: auth(rad) })).json()).count;
  expect(after).toBe(before - 1);
});

test('audit viewer + export enforce permissions', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const rad = await login(api, 'rad_ggh', testPassword('rad_ggh'));

  // admin can view + export
  expect((await api.get(`${BASE}/api/audit-logs?pageSize=3`, { headers: auth(adm) })).status()).toBe(200);
  const exp = await api.get(`${BASE}/api/audit-logs/export`, { headers: auth(adm) });
  expect(exp.ok()).toBeTruthy();
  expect((await exp.text()).startsWith('# Audit export')).toBeTruthy();

  // radiologist (no audit perms) is blocked
  expect((await api.get(`${BASE}/api/audit-logs`, { headers: auth(rad) })).status()).toBe(403);
  expect((await api.get(`${BASE}/api/audit-logs/export`, { headers: auth(rad) })).status()).toBe(403);
});

test('system health, dashboard, alerts endpoints', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  const health = await (await api.get(`${BASE}/api/system/health-status`, { headers: auth(adm) })).json();
  expect(Array.isArray(health)).toBeTruthy();
  const services = health.map((h) => h.service);
  for (const s of ['backend', 'postgres', 'redis', 'orthanc', 'mwl-scp', 'ohif', 'nginx']) {
    expect(services).toContain(s);
  }
  const dash = await (await api.get(`${BASE}/api/system/dashboard`, { headers: auth(adm) })).json();
  expect(dash).toHaveProperty('studiesToday');
  expect(dash).toHaveProperty('signedReports');
});

test('alert acknowledge then resolve lifecycle', async () => {
  const api = await request.newContext();
  const adm = await login(api, 'admin', testPassword('admin'));
  // Raise a synthetic alert is server-side; instead find or skip if none exist.
  const list = await (await api.get(`${BASE}/api/system/alerts?status=OPEN`, { headers: auth(adm) })).json();
  if (list.total === 0) return; // nothing to act on in this run
  const id = list.data[0].id;
  const acked = await (await api.post(`${BASE}/api/system/alerts/${id}/acknowledge`, { headers: auth(adm) })).json();
  expect(acked.status).toBe('ACKNOWLEDGED');
  const resolved = await (await api.post(`${BASE}/api/system/alerts/${id}/resolve`, { headers: auth(adm) })).json();
  expect(resolved.status).toBe('RESOLVED');
  expect(resolved.resolvedAt).toBeTruthy();
});
