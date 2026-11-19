import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Thin REST client for Orthanc. Uses global fetch (Node 24).
@Injectable()
export class OrthancService {
  private readonly log = new Logger('OrthancService');
  private base: string;
  private authHeader: string;

  constructor(private config: ConfigService) {
    this.base = (config.get<string>('ORTHANC_URL') ?? 'http://orthanc:8042').replace(/\/$/, '');
    const user = config.get<string>('ORTHANC_USERNAME') ?? 'orthanc';
    const pass = config.get<string>('ORTHANC_PASSWORD') ?? '';
    this.authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: this.authHeader, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Orthanc ${path} -> ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  async system() { return this.req('/system'); }
  async statistics() { return this.req('/statistics'); }

  async health(): Promise<{ up: boolean; version?: string; detail?: string }> {
    try {
      const sys = await this.system();
      return { up: true, version: sys?.Version };
    } catch (e: any) {
      return { up: false, detail: e.message };
    }
  }

  // Study-level
  listStudies(): Promise<string[]> { return this.req('/studies'); }
  getStudy(orthancId: string) { return this.req(`/studies/${orthancId}`); }
  getStudySeries(orthancId: string) { return this.req(`/studies/${orthancId}/series`); }
  getStudyInstances(orthancId: string) { return this.req(`/studies/${orthancId}/instances`); }

  // Full shared tags for a study (patient/study level DICOM tags)
  getStudyModule(orthancId: string) { return this.req(`/studies/${orthancId}/module?simplify`); }
  getStudyPatientModule(orthancId: string) { return this.req(`/studies/${orthancId}/module-patient?simplify`); }

  getSeries(seriesId: string) { return this.req(`/series/${seriesId}`); }
  getInstanceTags(instanceId: string) { return this.req(`/instances/${instanceId}/simplified-tags`); }

  // ── PACS reverse push (Module 1) — Orthanc native C-STORE SCU ──
  /** Find Orthanc's internal study id for a DICOM StudyInstanceUID. */
  async findStudyByUid(studyInstanceUid: string): Promise<string | null> {
    const res = await this.req('/tools/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Level: 'Study', Query: { StudyInstanceUID: studyInstanceUid } }),
    });
    return Array.isArray(res) && res.length ? res[0] : null;
  }

  /** Register/update a remote modality (destination PACS) at runtime. */
  async putModality(id: string, aet: string, host: string, port: number): Promise<void> {
    await this.req(`/modalities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ AET: aet, Host: host, Port: port }),
    });
  }

  async deleteModality(id: string): Promise<void> {
    try { await this.req(`/modalities/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* ignore */ }
  }

  /** C-ECHO test to a registered modality. Returns true on success. */
  async echoModality(id: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.req(`/modalities/${encodeURIComponent(id)}/echo`, { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, detail: e?.message };
    }
  }

  /** C-STORE a set of Orthanc resource ids to a modality. Async -> returns a Job id. */
  async storeToModality(id: string, resources: string[]): Promise<{ jobId: string }> {
    const res = await this.req(`/modalities/${encodeURIComponent(id)}/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Resources: resources, Asynchronous: true, Permissive: true }),
    });
    return { jobId: res?.ID ?? res?.Path?.split('/')?.pop() ?? '' };
  }

  /** Poll an Orthanc job for status + progress. */
  async getJob(jobId: string): Promise<any> {
    return this.req(`/jobs/${jobId}`);
  }

  /** Per-study statistics incl. real DiskSize (bytes). Used by storage management. */
  getStudyStatistics(orthancStudyId: string) { return this.req(`/studies/${orthancStudyId}/statistics`); }

  /** List SOP instance UIDs (+ orthanc ids) for a study. */
  async getStudyInstanceDetails(orthancStudyId: string): Promise<{ orthancId: string; sopInstanceUid: string }[]> {
    const ids: string[] = await this.getStudyInstances(orthancStudyId).then((r: any) =>
      Array.isArray(r) ? r.map((i: any) => (typeof i === 'string' ? i : i.ID)) : [],
    );
    const out: { orthancId: string; sopInstanceUid: string }[] = [];
    for (const iid of ids) {
      try {
        const tags = await this.getInstanceTags(iid);
        out.push({ orthancId: iid, sopInstanceUid: tags?.SOPInstanceUID ?? tags?.['0008,0018'] ?? iid });
      } catch { out.push({ orthancId: iid, sopInstanceUid: iid }); }
    }
    return out;
  }
}
