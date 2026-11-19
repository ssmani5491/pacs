// Central catalogue of roles and permissions.
// Role NAMES are proposed (brief section 11); confirm against Pixray's real roles.

export const PERMISSIONS = {
  // admin
  ORG_MANAGE: 'org.manage',
  DEPT_MANAGE: 'dept.manage',
  USER_MANAGE: 'user.manage',
  DOCTOR_MANAGE: 'doctor.manage',
  MODALITY_MANAGE: 'modality.manage',
  SETTINGS_MANAGE: 'settings.manage',
  // patients / orders
  PATIENT_VIEW: 'patient.view',
  PATIENT_MANAGE: 'patient.manage',
  ORDER_MANAGE: 'order.manage',
  // worklist / studies
  WORKLIST_VIEW: 'worklist.view',
  STUDY_VIEW: 'study.view',
  STUDY_ASSIGN: 'study.assign',
  STUDY_DELETE: 'study.delete',
  // reporting
  REPORT_VIEW: 'report.view',
  REPORT_CREATE: 'report.create',
  REPORT_EDIT: 'report.edit',
  REPORT_PRELIMINARY: 'report.preliminary',
  REPORT_FINALIZE: 'report.finalize',
  REPORT_SIGN: 'report.sign',
  REPORT_AMEND: 'report.amend',
  REPORT_DOWNLOAD: 'report.download',
  TEMPLATE_MANAGE: 'template.manage',
  // audit
  AUDIT_VIEW: 'audit.view',
  AUDIT_EXPORT: 'audit.export',
  // notifications (Phase 8)
  NOTIFICATION_VIEW: 'notification.view',
  NOTIFICATION_MANAGE: 'notification.manage',
  // system / operations (Phase 8)
  SYSTEM_DASHBOARD_VIEW: 'system.dashboard.view',
  SYSTEM_HEALTH_VIEW: 'system.health.view',
  SYSTEM_ALERT_VIEW: 'system.alert.view',
  SYSTEM_ALERT_ACK: 'system.alert.acknowledge',
  SYSTEM_ALERT_RESOLVE: 'system.alert.resolve',
  SYSTEM_JOBS_VIEW: 'system.jobs.view',
  SYSTEM_JOBS_MANAGE: 'system.jobs.manage',
  // PACS Operations — reverse push (Module 1)
  PACS_REVERSE_PUSH_VIEW: 'pacs.reverse-push.view',
  PACS_REVERSE_PUSH_MANAGE: 'pacs.reverse-push.manage',
  PACS_DESTINATION_MANAGE: 'pacs.destination.manage',
  // PACS Operations — archive compression (Module 2)
  PACS_ARCHIVE_VIEW: 'pacs.archive.view',
  PACS_ARCHIVE_MANAGE: 'pacs.archive.manage',
  // PACS Operations — storage management (Module 3)
  PACS_STORAGE_VIEW: 'pacs.storage.view',
  PACS_STORAGE_MANAGE: 'pacs.storage.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

// Proposed role catalogue. `super_admin` implicitly has all permissions.
export const ROLES: Record<string, { name: string; permissions: PermissionKey[] }> = {
  super_admin: { name: 'Super Administrator', permissions: ALL_PERMISSIONS },
  org_admin: {
    name: 'Organization Administrator',
    permissions: [
      PERMISSIONS.DEPT_MANAGE, PERMISSIONS.USER_MANAGE, PERMISSIONS.DOCTOR_MANAGE,
      PERMISSIONS.MODALITY_MANAGE, PERMISSIONS.PATIENT_MANAGE, PERMISSIONS.ORDER_MANAGE,
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW, PERMISSIONS.STUDY_ASSIGN,
      PERMISSIONS.TEMPLATE_MANAGE, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_EXPORT,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_DOWNLOAD,
      // Phase 8 — org admins run operations
      PERMISSIONS.NOTIFICATION_VIEW, PERMISSIONS.NOTIFICATION_MANAGE,
      PERMISSIONS.SYSTEM_DASHBOARD_VIEW, PERMISSIONS.SYSTEM_HEALTH_VIEW,
      PERMISSIONS.SYSTEM_ALERT_VIEW, PERMISSIONS.SYSTEM_ALERT_ACK, PERMISSIONS.SYSTEM_ALERT_RESOLVE,
      PERMISSIONS.SYSTEM_JOBS_VIEW,
      PERMISSIONS.PACS_REVERSE_PUSH_VIEW, PERMISSIONS.PACS_REVERSE_PUSH_MANAGE, PERMISSIONS.PACS_DESTINATION_MANAGE,
      PERMISSIONS.PACS_ARCHIVE_VIEW, PERMISSIONS.PACS_ARCHIVE_MANAGE,
      PERMISSIONS.PACS_STORAGE_VIEW, PERMISSIONS.PACS_STORAGE_MANAGE,
    ],
  },
  dept_admin: {
    name: 'Department Administrator',
    permissions: [
      PERMISSIONS.USER_MANAGE, PERMISSIONS.DOCTOR_MANAGE, PERMISSIONS.PATIENT_MANAGE,
      PERMISSIONS.ORDER_MANAGE, PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW,
      PERMISSIONS.STUDY_ASSIGN, PERMISSIONS.TEMPLATE_MANAGE,
      PERMISSIONS.NOTIFICATION_VIEW, PERMISSIONS.SYSTEM_DASHBOARD_VIEW,
      PERMISSIONS.SYSTEM_ALERT_VIEW, PERMISSIONS.SYSTEM_ALERT_ACK,
    ],
  },
  radiologist: {
    name: 'Radiologist',
    permissions: [
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW, PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_CREATE, PERMISSIONS.REPORT_EDIT,
      PERMISSIONS.REPORT_PRELIMINARY, PERMISSIONS.REPORT_FINALIZE, PERMISSIONS.REPORT_SIGN,
      PERMISSIONS.REPORT_AMEND, PERMISSIONS.REPORT_DOWNLOAD,
      PERMISSIONS.NOTIFICATION_VIEW,
    ],
  },
  reporting_doctor: {
    name: 'Reporting Doctor',
    permissions: [
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW, PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_CREATE, PERMISSIONS.REPORT_EDIT,
      PERMISSIONS.REPORT_PRELIMINARY, PERMISSIONS.REPORT_DOWNLOAD,
      PERMISSIONS.NOTIFICATION_VIEW,
    ],
  },
  technician: {
    name: 'Technician',
    permissions: [
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW, PERMISSIONS.PATIENT_MANAGE,
      PERMISSIONS.ORDER_MANAGE, PERMISSIONS.NOTIFICATION_VIEW,
    ],
  },
  receptionist: {
    name: 'Receptionist',
    permissions: [PERMISSIONS.PATIENT_MANAGE, PERMISSIONS.ORDER_MANAGE, PERMISSIONS.WORKLIST_VIEW,
      PERMISSIONS.NOTIFICATION_VIEW],
  },
  referring_doctor: {
    name: 'Referring Doctor',
    permissions: [
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.STUDY_VIEW, PERMISSIONS.PATIENT_VIEW,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_DOWNLOAD, PERMISSIONS.NOTIFICATION_VIEW,
    ],
  },
  pacs_admin: {
    name: 'PACS Administrator',
    permissions: [
      PERMISSIONS.MODALITY_MANAGE, PERMISSIONS.STUDY_VIEW, PERMISSIONS.STUDY_DELETE,
      PERMISSIONS.WORKLIST_VIEW, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.AUDIT_EXPORT, PERMISSIONS.NOTIFICATION_VIEW, PERMISSIONS.NOTIFICATION_MANAGE,
      PERMISSIONS.SYSTEM_DASHBOARD_VIEW, PERMISSIONS.SYSTEM_HEALTH_VIEW,
      PERMISSIONS.SYSTEM_ALERT_VIEW, PERMISSIONS.SYSTEM_ALERT_ACK, PERMISSIONS.SYSTEM_ALERT_RESOLVE,
      PERMISSIONS.SYSTEM_JOBS_VIEW, PERMISSIONS.SYSTEM_JOBS_MANAGE,
      PERMISSIONS.PACS_REVERSE_PUSH_VIEW, PERMISSIONS.PACS_REVERSE_PUSH_MANAGE, PERMISSIONS.PACS_DESTINATION_MANAGE,
      PERMISSIONS.PACS_ARCHIVE_VIEW, PERMISSIONS.PACS_ARCHIVE_MANAGE,
      PERMISSIONS.PACS_STORAGE_VIEW, PERMISSIONS.PACS_STORAGE_MANAGE,
    ],
  },
  auditor: {
    name: 'Auditor',
    permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_EXPORT, PERMISSIONS.WORKLIST_VIEW,
      PERMISSIONS.STUDY_VIEW, PERMISSIONS.NOTIFICATION_VIEW, PERMISSIONS.SYSTEM_DASHBOARD_VIEW],
  },
  // ── Test-only roles (PACS Operations Module 4) ──
  // Single-source roles so per-source history visibility can be proven with a real
  // JWT. Not assigned to any production user; used by tests/operations-history.spec.ts.
  test_rp_only: {
    name: 'Test — Reverse-Push View Only',
    permissions: [PERMISSIONS.PACS_REVERSE_PUSH_VIEW, PERMISSIONS.PATIENT_VIEW],
  },
  test_ar_only: {
    name: 'Test — Archive View Only (no patient.view)',
    permissions: [PERMISSIONS.PACS_ARCHIVE_VIEW],
  },
};
