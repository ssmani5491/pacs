/**
 * Phase 6 — OHIF viewer integration test (Playwright).
 *
 * Runs the real radiologist flow against the live stack:
 *   login (rad_ggh) -> worklist -> Open Study -> OHIF renders our synthetic
 *   CT volume -> switch to MPR -> verify 3 orthogonal viewports render.
 *
 * Also asserts organization isolation at the DICOMweb proxy (rad_tcl blocked).
 *
 * Prereqs (already created during Phase 6 testing; see scratchpad setup scripts):
 *   - users rad_ggh (org GGH) and rad_tcl (org TCL); rotated passwords read from
 *     a protected file outside the repo (see tests/lib/test-credentials.ts)
 *   - a GGH CT study with images (patient MRN VIEWERVOL01)
 *
 * Run:  BASE_URL=http://localhost npx playwright test tests/viewer.spec.ts
 */
import { test, expect, request } from '@playwright/test';
import { testPassword } from './lib/test-credentials';

const BASE = process.env.BASE_URL || 'http://localhost';
const RAD = { username: 'rad_ggh', password: testPassword('rad_ggh') };
const RAD_OTHER = { username: 'rad_tcl', password: testPassword('rad_tcl') };

async function login(api, creds) {
  const res = await api.post(`${BASE}/api/auth/login`, { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken;
}

test('DICOMweb proxy enforces authentication', async () => {
  const api = await request.newContext();
  const noAuth = await api.get(`${BASE}/api/dicom-web/studies`);
  expect(noAuth.status()).toBe(401);
});

test('organization isolation at the DICOMweb proxy', async () => {
  const api = await request.newContext();
  const tokGgh = await login(api, RAD);
  const tokTcl = await login(api, RAD_OTHER);

  // rad_ggh sees studies; rad_tcl (other org) sees none.
  const ggh = await api.get(`${BASE}/api/dicom-web/studies`, {
    headers: { Authorization: `Bearer ${tokGgh}`, Accept: 'application/dicom+json' },
  });
  const gghStudies = await ggh.json();
  expect(Array.isArray(gghStudies)).toBeTruthy();
  expect(gghStudies.length).toBeGreaterThan(0);

  const tcl = await api.get(`${BASE}/api/dicom-web/studies`, {
    headers: { Authorization: `Bearer ${tokTcl}`, Accept: 'application/dicom+json' },
  });
  const tclStudies = await tcl.json();
  expect(tclStudies.length).toBe(0);

  // rad_tcl cannot read a GGH study by UID (URL manipulation blocked).
  const uid = gghStudies[0]['0020000D'].Value[0];
  const forbidden = await api.get(`${BASE}/api/dicom-web/studies/${uid}/metadata`, {
    headers: { Authorization: `Bearer ${tokTcl}`, Accept: 'application/dicom+json' },
  });
  expect([403, 404]).toContain(forbidden.status());
});

test('WADO-RS pixel data streams through the proxy', async () => {
  const api = await request.newContext();
  const tok = await login(api, RAD);
  const studies = await (await api.get(`${BASE}/api/dicom-web/studies`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/dicom+json' },
  })).json();
  const uid = studies.find((s) => s['00080050']?.Value?.[0]?.startsWith('20261114'))['0020000D'].Value[0];

  const series = await (await api.get(`${BASE}/api/dicom-web/studies/${uid}/series`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/dicom+json' },
  })).json();
  const seriesUid = series[0]['0020000E'].Value[0];

  const instances = await (await api.get(`${BASE}/api/dicom-web/studies/${uid}/series/${seriesUid}/instances`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/dicom+json' },
  })).json();
  const instUid = instances[0]['00080018'].Value[0];

  const frame = await api.get(
    `${BASE}/api/dicom-web/studies/${uid}/series/${seriesUid}/instances/${instUid}/frames/1`,
    { headers: { Authorization: `Bearer ${tok}`, Accept: 'multipart/related; type="application/octet-stream"' } },
  );
  expect(frame.ok()).toBeTruthy();
  const body = await frame.body();
  expect(body.length).toBeGreaterThan(100000); // 256x256x2 pixel frame + multipart overhead
});

test('worklist Open Study loads OHIF and renders, then MPR works', async ({ page }) => {
  // Log in via the UI.
  await page.goto(`${BASE}/login`);
  await page.getByRole('textbox').first().fill(RAD.username);
  await page.locator('input[type="password"]').fill(RAD.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/`);

  // Find our volume on the worklist.
  await page.goto(`${BASE}/worklist`);
  await page.getByText('Patient ID').locator('..').getByRole('textbox').fill('VIEWERVOL01');
  await page.getByRole('button', { name: 'Search' }).click();

  // Open the 300-image study in the viewer (new tab).
  const [viewer] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: 'Open Study' }).nth(1).click(),
  ]);
  await viewer.waitForLoadState('domcontentloaded');
  expect(viewer.url()).toContain('/viewer/viewer?StudyInstanceUIDs=');

  // OHIF should render a canvas and show the instance count overlay.
  await viewer.waitForSelector('canvas', { timeout: 30000 });
  await expect(viewer.getByText(/\(1\/\d+\)/)).toBeVisible({ timeout: 30000 });

  // Dismiss the first-run guided tour (shepherd dialog) if present, so it does
  // not intercept toolbar clicks.
  const skip = viewer.getByRole('button', { name: 'Skip all' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await viewer.waitForTimeout(500);
  }

  // Switch to MPR and expect three viewports.
  await viewer.getByRole('button', { name: 'Change layout' }).click();
  await viewer.getByText('MPR', { exact: true }).click();
  await viewer.waitForTimeout(4000);
  const canvases = await viewer.locator('canvas').count();
  expect(canvases).toBeGreaterThanOrEqual(3);
});
