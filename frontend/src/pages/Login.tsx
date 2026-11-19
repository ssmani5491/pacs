import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(username, password);
      nav('/');
    } catch (e: any) {
      setErr(e.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ border: 'none', padding: 0, marginBottom: 16 }}>
          🩻 RIS·PACS <small>Enterprise Edition</small>
        </div>
        <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>Radiology administration console</p>
        {err && <div className="error">{err}</div>}
        <label>Username</label>
        <input value={username} onChange={(e) => setU(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setP(e.target.value)} />
        <button className="btn primary" style={{ width: '100%', marginTop: 18 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
