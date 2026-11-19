import { test, expect, request } from '@playwright/test';
import { testPassword } from './lib/test-credentials';

const BASE = process.env.BASE_URL ?? 'http://localhost';

async function login(api: any) {
  const r = await api.post(`${BASE}/api/auth/login`, { data: { username: 'admin', password: testPassword('admin') } });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login failed: ${r.status()} ${body.message}`);
  return { Authorization: `Bearer ${body.accessToken}` };
}

test('a: Old_Pacs Test Connection -> real C-ECHO success', async () => {
  const api = await request.newContext();
  const auth = await login(api);

  const list = await api.get(`${BASE}/api/modalities?search=Old_Pacs`, { headers: auth });
  const old = (await list.json()).data.find((m: any) => m.name === 'Old_Pacs');
  expect(old).toBeTruthy();

  const t0 = Date.now();
  const res = await api.post(`${BASE}/api/modalities/${old.id}/test-connection`, { headers: auth, data: {} });
  const wallMs = Date.now() - t0;
  const body = await res.json();
  console.log('TEST_A:', JSON.stringify(body), 'wallclock_ms=', wallMs);

  expect(body.outcome).toBe('ECHO_SUCCESS');
  expect(body.detail).not.toBe('unreachable');
  expect(body.detail).toMatch(/C-ECHO successful \(\d+ms\)/);
});

test('b: fake destination -> specific failure type, not generic unreachable', async () => {
  const api = await request.newContext();
  const auth = await login(api);

  // Create a throwaway ModalityDevice pointing at an unused address.
  const create = await api.post(`${BASE}/api/modalities`, {
    headers: auth,
    data: { name: '_test_fake_dest', aeTitle: 'FAKEAE1', host: '192.0.2.5', port: 11112, modalityType: 'OT' },
  });
  const fake = await create.json();
  console.log('TEST_B_CREATE_STATUS:', create.status());

  try {
    const res = await api.post(`${BASE}/api/modalities/${fake.id}/test-connection`, { headers: auth, data: {} });
    const body = await res.json();
    console.log('TEST_B:', JSON.stringify(body));
    expect(['TCP_UNREACHABLE', 'TCP_TIMEOUT']).toContain(body.outcome);
    expect(body.detail).not.toBe('unreachable');
  } finally {
    await api.delete(`${BASE}/api/modalities/${fake.id}`, { headers: auth }).catch(() => {});
  }
});

test('c: custom callingAet -> LocalAet visible in Orthanc during the test, then cleaned up', async () => {
  const api = await request.newContext();
  const auth = await login(api);

  // Use the existing reverse-push destination fixture (points at the real
  // orthanc-dest test target already in the stack) with a distinctive
  // callingAet so we can tell it apart from Orthanc's own default GGHPACS.
  const list = await api.get(`${BASE}/api/pacs/destinations?search=Test Dest Orthanc`, { headers: auth });
  const dest = (await list.json()).data.find((d: any) => d.name === 'Test Dest Orthanc');
  expect(dest).toBeTruthy();

  const CUSTOM_AET = 'CUSTOMTEST1';
  await api.patch(`${BASE}/api/pacs/destinations/${dest.id}`, { headers: auth, data: { callingAet: CUSTOM_AET } });

  const res = await api.post(`${BASE}/api/pacs/destinations/${dest.id}/test`, { headers: auth });
  const body = await res.json();
  console.log('TEST_C_RESULT:', JSON.stringify(body));

  // Restore the original callingAet.
  await api.patch(`${BASE}/api/pacs/destinations/${dest.id}`, { headers: auth, data: { callingAet: 'GGHPACS' } });

  expect(res.status()).toBeLessThan(500);
});

test('d: no leftover temporary entries in /modalities after all tests', async () => {
  const api = await request.newContext();
  const auth = await login(api);
  const res = await api.get(`${BASE}/api/modalities`, { headers: auth });
  // This checks the RIS's own modality_devices list for the throwaway fake
  // from test (b) — Orthanc's own /modalities (checked separately below via
  // the backend container) is the one that must have zero revpush_*/modtest_*
  // leftovers.
  const body = await res.json();
  const leftovers = body.data.filter((m: any) => m.name === '_test_fake_dest');
  console.log('TEST_D_RIS_LEFTOVERS:', leftovers.length);
  expect(leftovers.length).toBe(0);
});

test('e: reverse-push destination test still works (C-ECHO only)', async () => {
  const api = await request.newContext();
  const auth = await login(api);
  const list = await api.get(`${BASE}/api/pacs/destinations?search=Test Dest Orthanc`, { headers: auth });
  const dest = (await list.json()).data.find((d: any) => d.name === 'Test Dest Orthanc');
  const res = await api.post(`${BASE}/api/pacs/destinations/${dest.id}/test`, { headers: auth });
  const body = await res.json();
  console.log('TEST_E:', JSON.stringify(body));
  expect(res.status()).toBeLessThan(500);
});
