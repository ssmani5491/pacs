import React from 'react';

/**
 * Shared status/health/classification badge (Phase 2 GUI redesign).
 *
 * Consolidates the Badge/STATUS_COLOR/STATUS_CLASS implementations that were
 * independently duplicated across OperationsHistory, OperationalCommandCentre,
 * OperationsExceptions, SystemMonitoring, Worklist, AlertManagement,
 * MwlMonitor, ReceptionLogs, and ReportingWorklist (Phase 1 audit finding).
 * Every status string, colour, and meaning from those pages is preserved
 * exactly — this component only changes HOW the colour is applied (one
 * shared CSS variant class instead of each page's own inline style or an
 * unstyled className), never WHAT colour a given status renders as.
 */

export type StatusVariant =
  | 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  | 'indigo' | 'cyan' | 'heuristic';

/**
 * The full map of every status string found across the app's pages (Phase 1
 * audit) to its existing, already-shipped colour meaning. Centralising this
 * map is the actual fix for the duplication — pages that previously defined
 * their own STATUS_COLOR/STATUS_CLASS object now import this one instead.
 */
const STATUS_VARIANTS: Record<string, StatusVariant> = {
  // Reverse-push / archive job statuses (OperationsHistory, OperationalCommandCentre, OperationsExceptions)
  COMPLETED: 'success', VERIFIED: 'success', FAILED: 'danger', CANCELLED: 'neutral',
  PARTIALLY_COMPLETED: 'warning', RUNNING: 'info', QUEUED: 'info', PENDING: 'neutral',
  // Service health (SystemMonitoring, OperationalCommandCentre's HealthDot)
  HEALTHY: 'success', DEGRADED: 'warning', DOWN: 'danger', UNKNOWN: 'neutral',
  // RIS worklist / reporting lifecycle (Worklist, ReportingWorklist) — same
  // meaning as the existing --ready/--draft/--prelim/--final CSS variables.
  READY: 'info', DRAFT: 'neutral', PRELIMINARY: 'warning', FINAL: 'success', UNREPORTED: 'neutral',
  // System alerts (AlertManagement)
  OPEN: 'neutral', ACKNOWLEDGED: 'warning', RESOLVED: 'success',
  // MWL query logs (MwlMonitor)
  SUCCESS: 'success', NO_MATCH: 'warning', REJECTED: 'neutral',
  // DICOM reception logs (ReceptionLogs)
  INGESTED: 'success', MATCHED: 'success', RECEIVED: 'info', ORPHAN: 'warning', DUPLICATE: 'neutral',
  // Exceptions Console classification
  CONFIRMED: 'danger', HEURISTIC: 'heuristic', INFRASTRUCTURE: 'indigo',
  // Alert severity LEVEL (AlertManagement) — a different axis from job
  // status, kept here under its own names so the shared component covers it
  // too. NOTE: this preserves the EXISTING rendering exactly, including its
  // known limitation that HIGH and CRITICAL render identically (both were
  // mapped to the 'draft'/neutral badge class before this migration) — not
  // changed here, since Phase 2's brief is migration only, not a behaviour
  // fix. Flagged as an outstanding item in the Phase 2 report instead.
  INFO: 'neutral', WARNING: 'warning', HIGH: 'neutral', CRITICAL: 'neutral',
};

/** Resolve a status string to a variant, with an explicit, safe fallback. */
export function statusVariant(status: string): StatusVariant {
  return STATUS_VARIANTS[status] ?? 'neutral';
}

export interface StatusBadgeProps {
  /** The raw status/classification string (e.g. "COMPLETED", "FAILED"). */
  status: string;
  /** Override the looked-up variant (for a page with its own distinct mapping
   * that still wants the shared visual treatment, e.g. Exceptions' CONFIRMED). */
  variant?: StatusVariant;
  /** Override the displayed label (defaults to the raw status string). */
  label?: string;
}

/** The standard pill badge — replaces every page's local Badge/ClassBadge. */
export function StatusBadge({ status, variant, label }: StatusBadgeProps) {
  const v = variant ?? statusVariant(status);
  return <span className={`badge status-${v}`}>{label ?? status}</span>;
}

/** A small coloured dot + label, for service-health rows (replaces
 * SystemMonitoring's inline dot and OperationalCommandCentre's HealthDot).
 * Pass `label={null}` to render the dot alone (matching the original
 * HealthDot, used immediately before separately-rendered text). */
export function StatusDot({ status, label }: { status: string; label?: React.ReactNode }) {
  const v = statusVariant(status);
  if (label === null) {
    return <span className={`badge status-dot status-${v}`} style={{ padding: 0, marginRight: 6 }} />;
  }
  return (
    <span className={`badge status-dot status-${v}`}>
      {label ?? status}
    </span>
  );
}

/**
 * A labelled type badge for a fixed, small set of category strings (e.g.
 * REVERSE_PUSH/ARCHIVE). Replaces OperationsHistory's TypeBadge. `labels`
 * lets each call site keep its own exact wording (e.g. "PUSH" vs "ARCHIVE")
 * without hardcoding it here.
 */
export function TypeTag({ value, labels, variants }: {
  value: string;
  labels: Record<string, string>;
  variants: Record<string, StatusVariant>;
}) {
  const v = variants[value] ?? 'neutral';
  return <span className={`badge status-${v}`}>{labels[value] ?? value}</span>;
}
