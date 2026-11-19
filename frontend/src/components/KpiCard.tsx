import React from 'react';

/**
 * Shared KPI card (Phase 3 dashboard redesign). Extracted from the Tile
 * component already used by OperationalCommandCentre (Module 5) — same
 * visual result (a .card with a label, a big number, and an optional
 * sub-line), now shared instead of redefined. Uses the Phase 2 design
 * tokens for spacing/type instead of ad hoc inline sizes.
 */
export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  /** Optional accent colour for the value (e.g. a status token var). */
  color?: string;
  /** Optional small line under the value (trend, context, or unit). */
  sub?: React.ReactNode;
  /** Optional icon/emoji shown beside the label. */
  icon?: React.ReactNode;
  /** Optional click handler — renders as a button-like card for quick actions. */
  onClick?: () => void;
  /**
   * 'standard' (default) is the Phase 3 dashboard size (--font-3xl).
   * 'compact' reproduces the original Command Centre Tile's literal 22px/14px
   * sizing exactly, so reusing this component there doesn't resize its grid.
   */
  size?: 'standard' | 'compact';
}

export function KpiCard({ label, value, color, sub, icon, onClick, size = 'standard' }: KpiCardProps) {
  if (size === 'compact') {
    return (
      <div className="card" style={{ padding: 14, cursor: onClick ? 'pointer' : undefined }}
        onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
        <div className="muted" style={{ fontSize: 12 }}>{icon ? <>{icon} {label}</> : label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
        {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
      </div>
    );
  }
  return (
    <div
      className="card kpi-card"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="kpi-card-label">{icon && <span className="kpi-card-icon">{icon}</span>}{label}</div>
      <div className="kpi-card-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="kpi-card-sub">{sub}</div>}
    </div>
  );
}
