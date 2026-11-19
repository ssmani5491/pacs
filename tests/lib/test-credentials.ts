/**
 * Loads rotated test-account passwords from a protected local credential file,
 * stored OUTSIDE the repository under the Windows user profile (not inside the
 * project tree, and not subject to the project directory's broader inherited
 * NTFS ACLs — see the F-02 ACL remediation).
 *
 * No plaintext test password is committed to source. Missing credentials cause
 * an explicit, loud test-setup failure — never a silent fallback to a known
 * default (e.g. the old 'Test!1234').
 *
 * File format (JSON): { "recept1": "...", "rad_ggh": "...", "rad_tcl": "...", "admin": "..." }
 * Location is fixed (not derived from the repo path) so the file's restrictive
 * ACLs are independent of wherever this repository happens to be checked out.
 */
import * as fs from 'fs';

const CRED_FILE = 'C:\\Users\\user\\pacs_test_credentials.local';

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  if (!fs.existsSync(CRED_FILE)) {
    throw new Error(
      `Test credential file missing: ${CRED_FILE}\n` +
      `This file is intentionally NOT committed to source control. Create it with ` +
      `rotated passwords for the test accounts (recept1, rad_ggh, rad_tcl) before ` +
      `running tests that use them. See tests/lib/test-credentials.ts.`,
    );
  }
  const raw = fs.readFileSync(CRED_FILE, 'utf-8');
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Test credential file ${CRED_FILE} is not valid JSON: ${e.message}`);
  }
  cache = parsed;
  return parsed;
}

/** Returns the rotated password for a test-fixture username. Throws (never
 * falls back) if the file or the specific username is missing. */
export function testPassword(username: string): string {
  const creds = load();
  const pw = creds[username];
  if (!pw || typeof pw !== 'string') {
    throw new Error(
      `No test credential configured for username "${username}" in ${CRED_FILE}. ` +
      `Refusing to fall back to a hardcoded/default password.`,
    );
  }
  return pw;
}
