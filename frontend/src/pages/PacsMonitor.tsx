import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function PacsMonitor() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');

  const load = () => api.get('/pacs/monitor').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const Card = ({ label, value }: { label: string; value: any }) => (
    <div className="card"><div className="stat">{d ? (value ?? 0) : '—'}</div><div className="stat-label">{label}</div></div>
  );

  return (
    <div>
      <div className="page-head"><h1>PACS Monitoring</h1><button className="btn sm" onClick={load}>Refresh</button></div>
      {err && <div className="error">{err}</div>}

      <h3>Orthanc</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <span className={`badge ${d?.orthanc?.up ? 'ok' : 'off'}`}>{d?.orthanc?.up ? 'ONLINE' : 'OFFLINE'}</span>
        {d?.orthanc?.version && <span className="muted" style={{ marginLeft: 12 }}>v{d.orthanc.version}</span>}
        {d?.orthanc?.detail && <span className="muted" style={{ marginLeft: 12 }}>{d.orthanc.detail}</span>}
      </div>

      <h3>Storage</h3>
      <div className="cards">
        <Card label="Studies" value={d?.storage?.countStudies} />
        <Card label="Series" value={d?.storage?.countSeries} />
        <Card label="Instances" value={d?.storage?.countInstances} />
        <Card label="Disk Used (MB)" value={d?.storage?.totalDiskSizeMB} />
      </div>

      <h3 style={{ marginTop: 24 }}>DICOM Reception</h3>
      <div className="cards">
        <Card label="Received" value={d?.reception?.received} />
        <Card label="Ingested" value={d?.reception?.ingested} />
        <Card label="Orphan" value={d?.reception?.orphan} />
        <Card label="Failed" value={d?.reception?.failed} />
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>Auto-refreshes every 10s. All data is live from Orthanc and the database.</p>
    </div>
  );
}
