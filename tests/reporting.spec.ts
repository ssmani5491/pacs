/**
 * Phase 7 — reporting engine integration tests (Playwright, API-level + one UI flow).
 * Synthetic data only. Assumes the Phase 6/7 fixtures (rad_ggh, rad_tcl, VIEWERVOL01 studies).
 *
 * Run:  BASE_URL=http://localhost npx playwright test tests/reporting.spec.ts
 */
import { test, expect, request } from '@playwright/test';
import { testPassword } from './lib/test-credentials';

const BASE = process.env.BASE_URL || 'http://localhost';
const RAD = { username: 'rad_ggh', password: testPassword('rad_ggh') };
const OTHER = { username: 'rad_tcl', password: testPassword('rad_tcl') };

async function login(api, creds) {
  const r = await api.post(`${BASE}/api/auth/login`, { data: creds });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).accessToken;
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Pick the PRIOR study (acc ...002) so this suite owns a report independent of other runs.
async function priorStudyId(api, tok) {
  const wl = await (await api.get(`${BASE}/api/reporting-worklist?patientId=VIEWERVOL01&pageSize=10`, { headers: auth(tok) })).json();
  const row = wl.data.find((r) => r.accessionNumber === '20261114000002');
  return row.studyId;
}

test('full report lifecycle + immutability + addendum + pdf', async () => {
  const api = await request.newContext();
  const tok = await login(api, RAD);
  const studyId = await priorStudyId(api, tok);

  // Create (idempotent). If one already exists in a non-DRAFT state from a prior run,
  // this test still asserts the invariants on whatever state is reachable.
  const created = await (await api.post(`${BASE}/api/reports`, { headers: auth(tok), data: { studyId } })).json();
  const id = created.id;
  expect(id).toBeTruthy();

  // Ensure we have editable content; tolerate already-final reports from reruns.
  const cur = await (await api.get(`${BASE}/api/reports/${id}`, { headers: auth(tok) })).json();
  if (cur.status === 'DRAFT') {
    await api.patch(`${BASE}/api/reports/${id}`, { headers: auth(tok), data: { findings: 'Synthetic prior-study findings.', impression: 'Normal.' } });
    await api.post(`${BASE}/api/reports/${id}/finalize`, { headers: auth(tok) });
  } else if (cur.status === 'PRELIMINARY') {
    await api.post(`${BASE}/api/reports/${id}/finalize`, { headers: auth(tok) });
  }

  // Wrong-password sign -> 401
  const badSign = await api.post(`${BASE}/api/reports/${id}/sign`, { headers: auth(tok), data: { password: 'nope' } });
  expect(badSign.status()).toBe(401);

  // Correct sign (if not already locked)
  const beforeSign = await (await api.get(`${BASE}/api/reports/${id}`, { headers: auth(tok) })).json();
  if (!beforeSign.locked) {
    const ok = await api.post(`${BASE}/api/reports/${id}/sign`, { headers: auth(tok), data: { password: RAD.password } });
    expect(ok.ok()).toBeTruthy();
  }
  const signed = await (await api.get(`${BASE}/api/reports/${id}`, { headers: auth(tok) })).json();
  expect(signed.locked).toBe(true);
  expect(signed.status).toBe('FINAL');
  expect(signed.signatures.length).toBeGreaterThan(0);

  // Immutable: edit -> 409
  const edit = await api.patch(`${BASE}/api/reports/${id}`, { headers: auth(tok), data: { findings: 'tamper' } });
  expect(edit.status()).toBe(409);

  // Capture signed findings, then add an addendum, then confirm original unchanged.
  const findingsBefore = signed.findings;
  const add = await api.post(`${BASE}/api/reports/${id}/addendum`, { headers: auth(tok), data: { reason: 'extra note', findings: 'Addendum note.' } });
  expect(add.ok()).toBeTruthy();
  const addendum = await add.json();
  expect(addendum.parentReportId).toBe(id);

  const after = await (await api.get(`${BASE}/api/reports/${id}`, { headers: auth(tok) })).json();
  expect(after.findings).toBe(findingsBefore);
  expect(after.locked).toBe(true);

  // Version history present
  const versions = await (await api.get(`${BASE}/api/reports/${id}/versions`, { headers: auth(tok) })).json();
  expect(versions.length).toBeGreaterThanOrEqual(2);

  // PDF
  const pdf = await api.get(`${BASE}/api/reports/${id}/pdf`, { headers: auth(tok) });
  expect(pdf.ok()).toBeTruthy();
  const body = await pdf.body();
  expect(body.slice(0, 4).toString()).toBe('%PDF');
});

test('reporting org isolation', async () => {
  const api = await request.newContext();
  const tok = await login(api, RAD);
  const other = await login(api, OTHER);
  const studyId = await priorStudyId(api, tok);
  const rep = await (await api.get(`${BASE}/api/reports/study/${studyId}`, { headers: auth(tok) })).json();
  const id = rep.report?.id;
  expect(id).toBeTruthy();
  // Other-org radiologist cannot read this report.
  const blocked = await api.get(`${BASE}/api/reports/${id}`, { headers: auth(other) });
  expect([403, 404]).toContain(blocked.status());
});

test('reporting worklist buckets and counts', async () => {
  const api = await request.newContext();
  const tok = await login(api, RAD);
  const counts = await (await api.get(`${BASE}/api/reporting-worklist/counts`, { headers: auth(tok) })).json();
  expect(counts).toHaveProperty('FINAL');
  expect(counts).toHaveProperty('UNREPORTED');
  // Final bucket returns only final reports.
  const finals = await (await api.get(`${BASE}/api/reporting-worklist?bucket=FINAL&pageSize=50`, { headers: auth(tok) })).json();
  for (const r of finals.data) expect(r.reportStatus).toBe('FINAL');
});
