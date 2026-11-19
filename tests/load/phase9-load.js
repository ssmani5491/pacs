// Phase 9 Stage 3 — gentle load & concurrency test (k6).
// Run in a throwaway container (no host install, no 9th service):
//   docker run --rm --network pacs-replica_pacs -e BASE=http://nginx:80 \
//     -e RAD_GGH_PW=... -e RECEPT1_PW=... -e ADMIN_PW=... \
//     -v "<repo>/tests/load:/scripts" grafana/k6 run /scripts/phase9-load.js
//
// F-02 remediation: no password is hardcoded here. All three must be supplied via
// -e on the command line (read from your local, gitignored credential store) or
// the script throws immediately — it never falls back to a default.
//
// SAFE BY DESIGN: read-only endpoints only (login + GETs). No writes, no clinical
// records created. Gradual ramp to a conservative peak (20 VUs). Synthetic users.
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://nginx:80';
const loginTrend = new Trend('login_ms', true);
const readTrend = new Trend('read_ms', true);
const errRate = new Rate('errors');

export const options = {
  scenarios: {
    // Gradual ramp: 2 -> 10 -> 20 VUs, then down. Peak is intentionally modest.
    ramp: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '15s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '20s', target: 20 },
        { duration: '15s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    errors: ['rate<0.02'],          // < 2% errors
    read_ms: ['p(95)<800'],         // read P95 under 800ms even under load
    http_req_failed: ['rate<0.05'],
  },
};

// A small pool of synthetic users (already created in earlier phases).
// Passwords are NOT hardcoded here (F-02 remediation): they must be passed in via
// -e RAD_GGH_PW=... -e RECEPT1_PW=... -e ADMIN_PW=... on the k6 invocation. A
// missing value throws immediately — there is no silent fallback to a default.
function requiredEnv(name) {
  const v = __ENV[name];
  if (!v) {
    throw new Error(
      `${name} is not set. This script no longer has a hardcoded default password ` +
      `(F-02 remediation). Pass it explicitly: k6 run -e ${name}=... ${__ENV.K6_SCRIPT_NAME || 'phase9-load.js'}`,
    );
  }
  return v;
}
const USERS = [
  { u: 'rad_ggh', p: requiredEnv('RAD_GGH_PW') },
  { u: 'recept1', p: requiredEnv('RECEPT1_PW') },
  { u: 'admin', p: requiredEnv('ADMIN_PW') },
];

function login(user) {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ username: user.u, password: user.p }), {
    headers: { 'Content-Type': 'application/json' },
  });
  loginTrend.add(res.timings.duration);
  check(res, { 'login 200': (r) => r.status === 200 });
  if (res.status !== 200) { errRate.add(1); return null; }
  return res.json('accessToken');
}

export default function () {
  const user = USERS[__VU % USERS.length];
  const token = login(user);
  if (!token) { sleep(1); return; }
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  group('reads', () => {
    // Worklist (paginated), patient search, reporting worklist, notifications, audit (admin only).
    const reqs = [
      ['worklist', `${BASE}/api/worklist?pageSize=20`],
      ['worklist_filter', `${BASE}/api/worklist?modality=CT&pageSize=20`],
      ['patients', `${BASE}/api/patients?search=PERF&pageSize=20`],
      ['reporting', `${BASE}/api/reporting-worklist?pageSize=20`],
      ['notifications', `${BASE}/api/notifications?pageSize=20`],
    ];
    for (const [name, url] of reqs) {
      const r = http.get(url, authHeaders);
      readTrend.add(r.timings.duration);
      const ok = check(r, { [`${name} ok`]: (x) => x.status === 200 || x.status === 403 });
      if (!ok) errRate.add(1);
    }
  });
  sleep(Math.random() * 1 + 0.5); // 0.5-1.5s think time
}
