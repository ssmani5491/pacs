import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Organizations } from './pages/admin/Organizations';
import { Departments } from './pages/admin/Departments';
import { Doctors } from './pages/admin/Doctors';
import { Users } from './pages/admin/Users';
import { Modalities } from './pages/admin/Modalities';
import { Worklist } from './pages/Worklist';
import { Patients } from './pages/Patients';
import { PatientDetails } from './pages/PatientDetails';
import { StudyDetails } from './pages/StudyDetails';
import { Orders } from './pages/Orders';
import { PacsMonitor } from './pages/PacsMonitor';
import { ReceptionLogs } from './pages/ReceptionLogs';
import { Reconciliation } from './pages/Reconciliation';
import { MwlMonitor } from './pages/MwlMonitor';
import { ReportingWorklist } from './pages/ReportingWorklist';
import { ReportEditor } from './pages/ReportEditor';
import { ReportTemplates } from './pages/admin/ReportTemplates';
import { NotificationCentre } from './pages/NotificationCentre';
import { AuditLogs } from './pages/AuditLogs';
import { SystemMonitoring } from './pages/SystemMonitoring';
import { AlertManagement } from './pages/AlertManagement';
import { ReversePush } from './pages/ReversePush';
import { ArchiveManagement } from './pages/ArchiveManagement';
import { StorageManagement } from './pages/StorageManagement';
import { OperationsHistory } from './pages/OperationsHistory';
import { OperationalCommandCentre } from './pages/OperationalCommandCentre';
import { OperationsExceptions } from './pages/OperationsExceptions';

function Protected({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/worklist" element={<Protected><Worklist /></Protected>} />
          <Route path="/studies/:id" element={<Protected><StudyDetails /></Protected>} />
          <Route path="/patients" element={<Protected><Patients /></Protected>} />
          <Route path="/patients/:id" element={<Protected><PatientDetails /></Protected>} />
          <Route path="/orders" element={<Protected><Orders /></Protected>} />
          <Route path="/pacs/monitor" element={<Protected><PacsMonitor /></Protected>} />
          <Route path="/pacs/reception-logs" element={<Protected><ReceptionLogs /></Protected>} />
          <Route path="/pacs/reconciliation" element={<Protected><Reconciliation /></Protected>} />
          <Route path="/pacs/mwl" element={<Protected><MwlMonitor /></Protected>} />
          <Route path="/reporting" element={<Protected><ReportingWorklist /></Protected>} />
          <Route path="/reports/study/:studyId" element={<Protected><ReportEditor /></Protected>} />
          <Route path="/reports/:id" element={<Protected><ReportEditor /></Protected>} />
          <Route path="/admin/report-templates" element={<Protected><ReportTemplates /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationCentre /></Protected>} />
          <Route path="/ops/audit" element={<Protected><AuditLogs /></Protected>} />
          <Route path="/ops/monitoring" element={<Protected><SystemMonitoring /></Protected>} />
          <Route path="/ops/alerts" element={<Protected><AlertManagement /></Protected>} />
          <Route path="/pacs/reverse-push" element={<Protected><ReversePush /></Protected>} />
          <Route path="/pacs/archive" element={<Protected><ArchiveManagement /></Protected>} />
          <Route path="/pacs/storage" element={<Protected><StorageManagement /></Protected>} />
          <Route path="/pacs/operations/command-centre" element={<Protected><OperationalCommandCentre /></Protected>} />
          <Route path="/pacs/operations/exceptions" element={<Protected><OperationsExceptions /></Protected>} />
          <Route path="/pacs/operations/history" element={<Protected><OperationsHistory /></Protected>} />
          <Route path="/admin/organizations" element={<Protected><Organizations /></Protected>} />
          <Route path="/admin/departments" element={<Protected><Departments /></Protected>} />
          <Route path="/admin/doctors" element={<Protected><Doctors /></Protected>} />
          <Route path="/admin/users" element={<Protected><Users /></Protected>} />
          <Route path="/admin/modalities" element={<Protected><Modalities /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
