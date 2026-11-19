import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { connectNotifications } from '../lib/notificationsSocket';

const PRIORITY_DOT: Record<string, string> = {
  LOW: '#9aa5b1', NORMAL: '#3b82f6', HIGH: '#f59e0b', CRITICAL: '#ef4444',
};
const CAT_ICON: Record<string, string> = {
  NEW_STUDY: '🩻', STUDY_MATCHED: '🩻', ORPHAN_STUDY: '❓', RECONCILIATION: '🔗',
  REPORT_PRELIMINARY: '📝', REPORT_FINAL: '📄', REPORT_SIGNED: '✍️', REPORT_ADDENDUM: '➕',
  EXAM_ASSIGNED: '👤', EXAM_CANCELLED: '🚫', MODALITY_FAILURE: '⚠️', DICOM_FAILURE: '⚠️',
  MWL_ISSUE: '⚠️', SYSTEM_ALERT: '🔔',
};

/** Notification bell + unread badge + dropdown (Phase 8, Module B).
 * Live via Socket.IO, with /unread-count polling as the reliable fallback. */
export function NotificationBell() {
  const nav = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try { const r = await api.get('/notifications/unread-count'); setCount(r.count ?? 0); } catch { /* ignore */ }
  }, []);

  const loadRecent = useCallback(async () => {
    try { const r = await api.get('/notifications?pageSize=8'); setItems(r.data ?? []); } catch { /* ignore */ }
  }, []);

  // Poll every 20s (fallback) + connect socket for push.
  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 20000);
    const sock = connectNotifications(() => { refreshCount(); if (open) loadRecent(); });
    return () => { clearInterval(t); sock?.disconnect(); };
  }, [refreshCount, loadRecent, open]);

  // Close on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = () => { const n = !open; setOpen(n); if (n) loadRecent(); };

  const openItem = async (n: any) => {
    try { if (!n.read) await api.patch(`/notifications/${n.id}/read`); } catch { /* ignore */ }
    setOpen(false); refreshCount();
    if (n.link) nav(n.link);
  };

  const markAll = async () => {
    try { await api.patch('/notifications/read-all'); } catch { /* ignore */ }
    refreshCount(); loadRecent();
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={toggle} title="Notifications" aria-label="Notifications">
        🔔{count > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff',
            borderRadius: 10, fontSize: 10, minWidth: 16, height: 16, lineHeight: '16px',
            textAlign: 'center', padding: '0 4px', fontWeight: 700,
          }}>{count > 99 ? '99+' : count}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 36, width: 360, maxHeight: 460, overflowY: 'auto',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.18)', zIndex: 50,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <strong>Notifications</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={markAll}>Mark all read</button>
              <button className="btn sm" onClick={() => { setOpen(false); nav('/notifications'); }}>View all</button>
            </div>
          </div>
          {items.length === 0 && <div className="muted" style={{ padding: 16 }}>No notifications.</div>}
          {items.map((n) => (
            <div key={n.id} onClick={() => openItem(n)} style={{
              display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer',
              borderBottom: '1px solid var(--border)', background: n.read ? 'transparent' : 'rgba(59,130,246,.07)',
            }}>
              <span style={{ fontSize: 18 }}>{CAT_ICON[n.category] ?? '🔔'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: PRIORITY_DOT[n.priority] ?? '#3b82f6', flexShrink: 0 }} />
                  <strong style={{ fontSize: 13 }}>{n.title}</strong>
                </div>
                {n.body && <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                <div className="muted" style={{ fontSize: 11 }}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
