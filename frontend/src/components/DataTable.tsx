import React from 'react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPage: (page: number) => void;
  loading?: boolean;
}

export function DataTable<T extends { id: string }>(p: Props<T>) {
  return (
    <div>
      <table>
        <thead>
          <tr>
            {p.columns.map((c) => (
              <th key={c.key} onClick={() => c.sortable && p.onSort(c.key)}>
                {c.label}
                {p.sortBy === c.key ? (p.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.loading && (
            <tr><td colSpan={p.columns.length} className="muted">Loading…</td></tr>
          )}
          {!p.loading && p.rows.length === 0 && (
            <tr><td colSpan={p.columns.length} className="muted">No records found.</td></tr>
          )}
          {!p.loading && p.rows.map((row) => (
            <tr key={row.id}>
              {p.columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(row) : (row as any)[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pager">
        <span className="muted">{p.total} total · page {p.page}/{p.totalPages}</span>
        <button className="btn sm" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>Prev</button>
        <button className="btn sm" disabled={p.page >= p.totalPages} onClick={() => p.onPage(p.page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-head"><h1 style={{ fontSize: 17 }}>{title}</h1>
          <button className="btn sm" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}
