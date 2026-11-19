import React, { useState } from 'react';
import { api } from '../lib/api';

// Self-service password change for the currently logged-in user (any role,
// including admin/super_admin). Uses the existing, already-authorized
// POST /auth/change-password endpoint — no new backend code.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setErr('');
    if (newPassword.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setErr('New password and confirmation do not match.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setDone(true);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to change password');
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-head"><h1 style={{ fontSize: 17 }}>Change Password</h1>
          <button className="btn sm" onClick={onClose}>✕</button></div>

        {done ? (
          <>
            <div className="success">Password changed successfully.</div>
            <button className="btn primary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            {err && <div className="error">{err}</div>}
            <div className="adm-form-group">
              <label>Current Password<span className="adm-required">*</span></label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
            </div>
            <div className="adm-form-group" style={{ marginTop: 10 }}>
              <label>New Password<span className="adm-required">*</span></label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <div className="muted" style={{ fontSize: 11 }}>Minimum 8 characters.</div>
            </div>
            <div className="adm-form-group" style={{ marginTop: 10 }}>
              <label>Confirm New Password<span className="adm-required">*</span></label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" onClick={submit} disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
                {saving ? 'Saving…' : 'Change Password'}
              </button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
