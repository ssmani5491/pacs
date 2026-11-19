import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { AlertsService } from '../ops/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { skipTake, paginate } from '../common/pagination';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_THRESHOLDS = { info: 70, warning: 80, high: 90, critical: 95 };

/**
 * Storage Management (PACS Operations Module 3). READ-ONLY over real data:
 * Orthanc /statistics (+ per-study DiskSize), the archive volume, and the host
 * filesystem. Never deletes/migrates/modifies DICOM or archives. Periodic
 * snapshots feed the dashboard, growth tracking, and linear forecasting; crossing
 * a configured utilization threshold raises a Phase 8 SystemAlert + notification.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('StorageService');
  private readonly archiveRoot: string;
  private orthancAuth: string;
  private orthancBase: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private orthanc: OrthancService,
    private alerts: AlertsService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {
    this.archiveRoot = this.config.get<string>('ARCHIVE_ROOT') ?? '/var/lib/pacs/archive';
    const user = config.get<string>('ORTHANC_USERNAME') ?? 'orthanc';
    const pass = config.get<string>('ORTHANC_PASSWORD') ?? '';
    this.orthancAuth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    this.orthancBase = (config.get<string>('ORTHANC_URL') ?? 'http://orthanc:8042').replace(/\/$/, '');
  }

  private can(u: AuthUser, p: string) { return u.isSuperAdmin || u.permissions.includes(p); }
  private require(u: AuthUser, p: string) { if (!this.can(u, p)) throw new ForbiddenException(`Missing permission: ${p}`); }

  // ───────────────────────── config ─────────────────────────

  async getConfig(user: AuthUser) {
    this.require(user, PERMISSIONS.PACS_STORAGE_VIEW);
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'storage.config' } });
    const v = (row?.value as any) ?? {};
    return { thresholds: { ...DEFAULT_THRESHOLDS, ...(v.thresholds ?? {}) }, archiveRoot: this.archiveRoot };
  }

  async setConfig(user: AuthUser, dto: any, ip?: string) {
    this.require(user, PERMISSIONS.PACS_STORAGE_MANAGE);
    const t = dto.thresholds ?? {};
    const thresholds = {
      info: clamp(t.info ?? DEFAULT_THRESHOLDS.info),
      warning: clamp(t.warning ?? DEFAULT_THRESHOLDS.warning),
      high: clamp(t.high ?? DEFAULT_THRESHOLDS.high),
      critical: clamp(t.critical ?? DEFAULT_THRESHOLDS.critical),
    };
    await this.prisma.systemSetting.upsert({ where: { key: 'storage.config' }, update: { value: { thresholds } }, create: { key: 'storage.config', value: { thresholds } } });
    await this.audit.log({ userId: user.id, action: 'STORAGE_CONFIG_UPDATE', detail: thresholds, ip });
    return this.getConfig(user);
  }

  // ───────────────────────── live measurement ─────────────────────────

  private async orthancReq(path: string): Promise<any> {
    const res = await fetch(`${this.orthancBase}${path}`, { headers: { Authorization: this.orthancAuth } });
    if (!res.ok) throw new Error(`Orthanc ${path} -> ${res.status}`);
    return res.json();
  }

  /** Archive volume usage (real, recursive). */
  private archiveBytes(): number {
    let total = 0;
    const walk = (dir: string) => {
      let items: fs.Dirent[] = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of items) { const p = path.join(dir, it.name); if (it.isDirectory()) walk(p); else { try { total += fs.statSync(p).size; } catch { /* ignore */ } } }
    };
    walk(this.archiveRoot);
    return total;
  }

  /** Host filesystem capacity for the archive mount (real, via statfs). */
  private diskStats(): { total: number; used: number; avail: number } {
    try {
      const s: any = (fs as any).statfsSync(this.archiveRoot);
      const total = s.blocks * s.bsize;
      const avail = s.bavail * s.bsize;
      return { total, used: total - avail, avail };
    } catch { return { total: 0, used: 0, avail: 0 }; }
  }

  /** Compute a full, REAL snapshot. Walks Orthanc once for per-study DiskSize to
   * build modality-wise storage (no estimates). */
  async computeSnapshot(): Promise<any> {
    const stats = await this.orthancReq('/statistics');
    const orthancBytes = Number(stats.TotalDiskSize ?? 0) || (Number(stats.TotalDiskSizeMB ?? 0) * 1024 * 1024);

    // Per-modality bytes: group RIS studies by modality, sum each study's real
    // Orthanc DiskSize. (RIS knows the modality; Orthanc knows the bytes.)
    const studies = await this.prisma.study.findMany({
      where: { orthancStudyId: { not: null } },
      select: { orthancStudyId: true, modality: true },
    });
    const breakdown: Record<string, { count: number; bytes: number }> = {};
    for (const s of studies) {
      const mod = s.modality || 'OTHER';
      if (!breakdown[mod]) breakdown[mod] = { count: 0, bytes: 0 };
      breakdown[mod].count++;
      try {
        const ss = await this.orthanc.getStudyStatistics(s.orthancStudyId!);
        breakdown[mod].bytes += Number(ss.DiskSize ?? 0);
      } catch { /* study may be gone; skip */ }
    }

    const archiveBytes = this.archiveBytes();
    const disk = this.diskStats();
    return {
      orthancBytes, archiveBytes,
      diskTotalBytes: disk.total, diskUsedBytes: disk.used, diskAvailBytes: disk.avail,
      patients: Number(stats.CountPatients ?? 0), studies: Number(stats.CountStudies ?? 0),
      series: Number(stats.CountSeries ?? 0), instances: Number(stats.CountInstances ?? 0),
      modalityBreakdown: breakdown,
    };
  }

  /** Persist a snapshot and evaluate alert thresholds. */
  async captureSnapshot(reason = 'scheduled'): Promise<any> {
    const snap = await this.computeSnapshot();
    const row = await this.prisma.storageSnapshot.create({
      data: {
        orthancBytes: BigInt(snap.orthancBytes), archiveBytes: BigInt(snap.archiveBytes),
        diskTotalBytes: BigInt(snap.diskTotalBytes), diskUsedBytes: BigInt(snap.diskUsedBytes), diskAvailBytes: BigInt(snap.diskAvailBytes),
        patients: snap.patients, studies: snap.studies, series: snap.series, instances: snap.instances,
        modalityBreakdown: snap.modalityBreakdown,
      },
    });
    await this.evaluateAlerts(snap);
    this.log.log(`storage snapshot captured (${reason}): disk ${pct(snap.diskUsedBytes, snap.diskTotalBytes)}% used`);
    return this.serialize(row);
  }

  /** Raise/recover a storage alert based on disk utilization vs configured thresholds. */
  private async evaluateAlerts(snap: any) {
    const cfg = await this.prisma.systemSetting.findUnique({ where: { key: 'storage.config' } });
    const th = { ...DEFAULT_THRESHOLDS, ...(((cfg?.value as any)?.thresholds) ?? {}) };
    const used = pct(snap.diskUsedBytes, snap.diskTotalBytes);
    const key = 'storage:disk:utilization';
    let level: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL' | null = null;
    if (used >= th.critical) level = 'CRITICAL';
    else if (used >= th.high) level = 'HIGH';
    else if (used >= th.warning) level = 'WARNING';
    else if (used >= th.info) level = 'INFO';

    if (level) {
      await this.alerts.raise({ alertKey: key, level, source: 'STORAGE', title: `Disk utilization ${used}% (≥ ${level.toLowerCase()} threshold)`, detail: `Disk ${used}% used; archive ${bytesH(snap.archiveBytes)}, Orthanc ${bytesH(snap.orthancBytes)}.` });
      await this.notifications.create({ category: 'SYSTEM_ALERT', priority: level === 'CRITICAL' ? 'CRITICAL' : level === 'HIGH' ? 'HIGH' : 'NORMAL', roleKey: 'pacs_admin', dedupKey: `storage-alert:${level}:${new Date().toISOString().slice(0, 10)}`, title: `Storage ${level.toLowerCase()}: disk ${used}%`, body: `Disk utilization reached ${used}%.`, link: '/pacs/storage' });
    } else {
      await this.alerts.recover(key);
    }
  }

  // ───────────────────────── dashboard ─────────────────────────

  async dashboard(user: AuthUser) {
    this.require(user, PERMISSIONS.PACS_STORAGE_VIEW);
    // Use the latest snapshot if fresh (<10 min); else compute live (don't persist on every view).
    let snap = await this.prisma.storageSnapshot.findFirst({ orderBy: { capturedAt: 'desc' } });
    let data: any;
    if (snap && Date.now() - new Date(snap.capturedAt).getTime() < 10 * 60 * 1000) {
      data = this.serialize(snap);
    } else {
      data = await this.computeSnapshot();
    }
    const cfg = await this.getConfig(user);
    const diskUsedPct = pct(Number(data.diskUsedBytes), Number(data.diskTotalBytes));
    const orthancOfDisk = pct(Number(data.orthancBytes), Number(data.diskTotalBytes));
    const archiveOfDisk = pct(Number(data.archiveBytes), Number(data.diskTotalBytes));
    return {
      orthanc: { bytes: Number(data.orthancBytes), patients: data.patients, studies: data.studies, series: data.series, instances: data.instances },
      archive: { bytes: Number(data.archiveBytes) },
      disk: { totalBytes: Number(data.diskTotalBytes), usedBytes: Number(data.diskUsedBytes), availableBytes: Number(data.diskAvailBytes), usedPercent: diskUsedPct, orthancPercent: orthancOfDisk, archivePercent: archiveOfDisk },
      modalityBreakdown: this.modalityArray(data.modalityBreakdown),
      thresholds: cfg.thresholds,
      alertLevel: this.levelFor(diskUsedPct, cfg.thresholds),
      growth: await this.growth(),
      generatedAt: new Date().toISOString(),
    };
  }

  private levelFor(used: number, th: any): string | null {
    if (used >= th.critical) return 'CRITICAL';
    if (used >= th.high) return 'HIGH';
    if (used >= th.warning) return 'WARNING';
    if (used >= th.info) return 'INFO';
    return null;
  }

  // ───────────────────────── growth + forecast ─────────────────────────

  /** Daily/monthly growth + days-until-threshold forecast from REAL snapshots. */
  async growth() {
    const rows = await this.prisma.storageSnapshot.findMany({ orderBy: { capturedAt: 'asc' }, take: 365 });
    if (rows.length < 2) return { daily: [], dailyGrowthBytes: null, monthlyGrowthBytes: null, forecast: null, note: 'need >=2 snapshots for growth; forecast unavailable' };

    const series = rows.map((r) => ({ at: r.capturedAt, used: Number(r.diskUsedBytes), total: Number(r.diskTotalBytes) }));
    const first = series[0], last = series[series.length - 1];
    const days = Math.max((new Date(last.at).getTime() - new Date(first.at).getTime()) / 86400000, 1 / 24);
    const dailyGrowth = (last.used - first.used) / days;

    // Linear forecast: days until the next threshold is crossed at the current daily rate.
    const total = last.total || 1;
    const forecast: Record<string, number | null> = {};
    for (const [name, p] of Object.entries({ p70: 70, p80: 80, p90: 90, p95: 95 })) {
      const targetBytes = (p / 100) * total;
      if (dailyGrowth <= 0) forecast[name] = null; // not growing -> no ETA
      else if (last.used >= targetBytes) forecast[name] = 0; // already past
      else forecast[name] = Math.round((targetBytes - last.used) / dailyGrowth);
    }
    return {
      daily: series.slice(-30).map((s) => ({ at: s.at, usedBytes: s.used })),
      dailyGrowthBytes: Math.round(dailyGrowth),
      monthlyGrowthBytes: Math.round(dailyGrowth * 30),
      forecast: { daysUntil: forecast, basis: `${rows.length} snapshots over ${days.toFixed(1)} days (linear)` },
    };
  }

  // ───────────────────────── history + CSV export ─────────────────────────

  async history(user: AuthUser, q: any) {
    this.require(user, PERMISSIONS.PACS_STORAGE_VIEW);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.storageSnapshot.findMany({ orderBy: { capturedAt: 'desc' }, ...skipTake(q) }),
      this.prisma.storageSnapshot.count(),
    ]);
    return paginate(rows.map((r) => this.serialize(r)), total, q);
  }

  async exportCsv(user: AuthUser, ip?: string): Promise<string> {
    this.require(user, PERMISSIONS.PACS_STORAGE_VIEW);
    const rows = await this.prisma.storageSnapshot.findMany({ orderBy: { capturedAt: 'desc' }, take: 5000 });
    const headers = ['capturedAt', 'orthancBytes', 'archiveBytes', 'diskTotalBytes', 'diskUsedBytes', 'diskAvailBytes', 'diskUsedPercent', 'patients', 'studies', 'series', 'instances'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.capturedAt.toISOString(), Number(r.orthancBytes), Number(r.archiveBytes),
        Number(r.diskTotalBytes), Number(r.diskUsedBytes), Number(r.diskAvailBytes),
        pct(Number(r.diskUsedBytes), Number(r.diskTotalBytes)),
        r.patients, r.studies, r.series, r.instances,
      ].map(csv).join(','));
    }
    await this.audit.log({ userId: user.id, action: 'STORAGE_HISTORY_EXPORT', detail: { rows: rows.length }, ip });
    return `# Storage history export | by ${user.username} | ${new Date().toISOString()} | ${rows.length} rows\n` + lines.join('\n') + '\n';
  }

  /** Admin-triggered immediate snapshot. */
  async triggerSnapshot(user: AuthUser, ip?: string) {
    this.require(user, PERMISSIONS.PACS_STORAGE_MANAGE);
    const r = await this.captureSnapshot('manual');
    await this.audit.log({ userId: user.id, action: 'STORAGE_SNAPSHOT_MANUAL', ip });
    return r;
  }

  // ───────────────────────── helpers ─────────────────────────

  private serialize(r: any) {
    return {
      ...r,
      orthancBytes: Number(r.orthancBytes), archiveBytes: Number(r.archiveBytes),
      diskTotalBytes: Number(r.diskTotalBytes), diskUsedBytes: Number(r.diskUsedBytes), diskAvailBytes: Number(r.diskAvailBytes),
    };
  }
  private modalityArray(b: any) {
    if (!b) return [];
    return Object.entries(b).map(([modality, v]: any) => ({ modality, count: v.count ?? 0, bytes: v.bytes ?? 0 })).sort((a, b) => b.bytes - a.bytes);
  }
}

function clamp(n: any) { const v = Number(n); return Math.max(1, Math.min(100, isNaN(v) ? 0 : v)); }
function pct(used: number, total: number) { return total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0; }
function bytesH(b: number) { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = b, i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(1)} ${u[i]}`; }
function csv(v: any): string { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }
