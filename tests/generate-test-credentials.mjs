// One-time utility (F-02 remediation): generates strong, unique passwords for
// the test-fixture accounts and writes them to a protected file OUTSIDE the
// repository, under the Windows user profile (see tests/lib/test-credentials.ts
// for why: the project directory's inherited NTFS ACLs are broader than the
// user profile's). Never printed to stdout, never placed in a command argument
// or shell history.
//
// Run once: node tests/generate-test-credentials.mjs
// Then rotate each account's real password via the application API to match,
// and apply restrictive icacls to the output file (see F-02 ACL remediation).
import { randomBytes } from 'crypto';
import { writeFileSync, existsSync } from 'fs';

const outFile = 'C:\\Users\\user\\pacs_test_credentials.local';

function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_=+';
  const bytes = randomBytes(24);
  let out = 'Tst-';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

if (existsSync(outFile)) {
  console.error(`Refusing to overwrite existing ${outFile}. Delete it first if you really want new credentials.`);
  process.exit(1);
}

const creds = {
  recept1: strongPassword(),
  rad_ggh: strongPassword(),
  rad_tcl: strongPassword(),
};

writeFileSync(outFile, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
console.log(`Wrote 3 credentials to ${outFile} (not printed; file permissions set to 600).`);
