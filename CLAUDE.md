# Project rules for Claude

- **Never reset or change any existing user's password** (via the Reset Password
  admin UI, direct SQL, or any other means) without the user's explicit approval
  for that specific account, given in the moment it's needed. This includes test
  accounts like `admin` — a stale local credentials file is not authorization to
  reset the password instead of asking. (Added 2026-11-19, after an admin
  password reset during earlier feature testing left the protected
  `pacs_test_credentials.local` file out of sync, which later caused automated
  test runs to trigger real failed-login attempts and lock the account.)
