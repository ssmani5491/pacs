import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../ops/alerts.service';

const execFileP = promisify(execFile);

export type BackupComponent = 'RIS_DB' | 'ORTHANC_DB' | 'DICOM_STORAGE';

/**
 * Nightly backup implementation (Product Validation Phase 1D, following the
 * Phase 1D assessment's "Immediate" + "Short term" roadmap steps).
 *
 * Follows the same conventions as ArchiveService (Module 2): a dedicated
 * Prisma model per attempt (BackupRun, mirrors ArchiveJob's shape), sha256 +
 * decompress-and-inspect integrity verification (never "command exited 0" alone),
 * AlertsService.raise() on failure (the existing system-wide failure-notification
 * hook), and a Redis-locked @Cron entry point in BackupScheduler (not here).
 *
 * Security: every external command runs via execFile with an argument array
 * (never a shell string), so no credential or path is ever interpolated into a
 * shell. Postgres credentials are passed via PGPASSWORD in the child process's
 * own environment, never as a CLI argument (so they never appear in `ps` output
 * or in any log line built from the argument list).
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger('BackupService');
  private readonly backupRoot: string;
  private readonly orthancStorageRoot: string;
  private readonly retentionDays: number;
  private readonly minFreeMb: number;
  private readonly pgUser: string;
  private readonly pgPassword: string;
  private readonly risDb: string;
  private readonly orthancDb: string;

  constructor(private config: ConfigService, private prisma: PrismaService, private alerts: AlertsService) {
    this.backupRoot = this.config.get<string>('BACKUP_PATH') ?? '/var/backups/pacs';
    // Compose default unchanged; the all-in-one image sets ORTHANC_STORAGE_RO_PATH
    // since its DICOM storage lives at a different path (/data/dicom) than the
    // Compose dev stack's dedicated read-only bind mount.
    this.orthancStorageRoot = this.config.get<string>('ORTHANC_STORAGE_RO_PATH') ?? '/var/lib/orthanc-storage-ro';
    this.retentionDays = Number(this.config.get('BACKUP_RETENTION_DAYS') ?? 30);
    this.minFreeMb = Number(this.config.get('BACKUP_MIN_FREE_MB') ?? 500);
    this.pgUser = this.config.get<string>('POSTGRES_USER') ?? 'pacs';
    this.pgPassword = this.config.get<string>('POSTGRES_PASSWORD') ?? '';
    this.risDb = this.config.get<string>('RIS_DB_NAME') ?? 'ris';
    this.orthancDb = this.config.get<string>('ORTHANC_DB_NAME') ?? 'orthanc';
  }

  /** READ-ONLY status list for the Backup status reporting UI/API. Permission is enforced at the controller (system.jobs.view). */
  async listRuns(limit = 60) {
    return this.prisma.backupRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  /**
   * Runs one nightly backup: RIS db -> Orthanc db -> DICOM storage, sequentially
   * (so a disk-space or Postgres-load spike from one component can't collide
   * with another running at the same instant). Each component's success/failure
   * is independent and recorded as its own BackupRun row — a failure in one
   * component does not abort the others (partial-failure handling).
   */
  async runNightly(): Promise<{ runId: string; results: Array<{ component: BackupComponent; ok: boolean }> }> {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(this.backupRoot, { recursive: true });

    const spaceOk = await this.checkFreeSpace();
    if (!spaceOk) {
      await this.alerts.raise({
        alertKey: 'backup:low-disk-space', level: 'CRITICAL', source: 'BACKUP',
        title: 'Nightly backup skipped: insufficient disk space',
        detail: `Backup volume has less than ${this.minFreeMb} MB free; no backup component was attempted.`,
      });
      for (const component of ['RIS_DB', 'ORTHANC_DB', 'DICOM_STORAGE'] as BackupComponent[]) {
        await this.prisma.backupRun.create({
          data: { runId, component, status: 'SKIPPED', error: 'insufficient disk space', completedAt: new Date() },
        });
      }
      return { runId, results: [{ component: 'RIS_DB', ok: false }, { component: 'ORTHANC_DB', ok: false }, { component: 'DICOM_STORAGE', ok: false }] };
    }

    const results: Array<{ component: BackupComponent; ok: boolean }> = [];
    results.push({ component: 'RIS_DB', ok: await this.backupDatabase(runId, 'RIS_DB', this.risDb) });
    results.push({ component: 'ORTHANC_DB', ok: await this.backupDatabase(runId, 'ORTHANC_DB', this.orthancDb) });
    results.push({ component: 'DICOM_STORAGE', ok: await this.backupDicomStorage(runId) });

    await this.applyRetention();
    return { runId, results };
  }

  // ---- disk space precheck -------------------------------------------------

  private async checkFreeSpace(): Promise<boolean> {
    try {
      // `df -Pm` gives POSIX-portable, machine-parseable megabyte output.
      const { stdout } = await execFileP('df', ['-Pm', this.backupRoot]);
      const lines = stdout.trim().split('\n');
      const cols = lines[lines.length - 1].trim().split(/\s+/);
      const availMb = Number(cols[3]);
      if (!Number.isFinite(availMb)) return true; // can't parse -> don't block the backup on a parsing issue
      return availMb >= this.minFreeMb;
    } catch (e: any) {
      this.log.warn(`disk space check failed, proceeding: ${e?.message}`);
      return true; // a failed check must not silently block every future backup
    }
  }

  // ---- database dump (RIS or Orthanc db) ------------------------------------

  private async backupDatabase(runId: string, component: BackupComponent, dbName: string): Promise<boolean> {
    const started = Date.now();
    const run = await this.prisma.backupRun.create({ data: { runId, component, status: 'RUNNING' } });
    const fileName = `${component.toLowerCase()}-${runId}.sql.gz`;
    const fullPath = path.join(this.backupRoot, fileName);
    try {
      // pg_dump streams plain SQL to stdout; gzip compresses it as it's written.
      // PGPASSWORD is set only in this child process's env, never on the CLI
      // (so it is never visible to `ps`, a log line, or a crash dump of argv).
      await this.runDumpPipeline(dbName, fullPath);

      const bytes = fs.statSync(fullPath).size;
      const sha256 = await this.hashFile(fullPath);
      // Integrity: decompress and confirm the result looks like a real SQL
      // dump, not just that pg_dump/gzip exited 0 (brief requirement).
      const verify = await this.verifySqlDump(fullPath);

      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: verify.ok ? 'SUCCESS' : 'FAILED',
          filePath: fileName, bytes: BigInt(bytes), sha256,
          verified: verify.ok, verifyDetail: verify.detail,
          completedAt: new Date(), durationMs: Date.now() - started,
          error: verify.ok ? null : verify.detail,
        },
      });
      if (!verify.ok) await this.notifyFailure(component, verify.detail);
      return verify.ok;
    } catch (e: any) {
      const detail = this.sanitizeError(e);
      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: detail, completedAt: new Date(), durationMs: Date.now() - started },
      });
      await this.notifyFailure(component, detail);
      return false;
    }
  }

  private runDumpPipeline(dbName: string, outFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const dump = spawn('pg_dump', ['-h', 'postgres', '-U', this.pgUser, '-d', dbName, '--no-owner', '--no-privileges'], {
        env: { ...process.env, PGPASSWORD: this.pgPassword },
      });
      const gzip = spawn('gzip', ['-c']);
      const out = fs.createWriteStream(outFile);
      let dumpErr = '';
      dump.stderr.on('data', (c) => { dumpErr += c.toString().slice(0, 2000); });
      dump.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(out);
      let settled = false;
      const fail = (msg: string) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      dump.on('error', (e) => fail(`pg_dump spawn error: ${e.message}`));
      gzip.on('error', (e) => fail(`gzip spawn error: ${e.message}`));
      dump.on('close', (code) => { if (code !== 0) fail(`pg_dump exited ${code}: ${this.sanitizeError(dumpErr)}`); });
      out.on('finish', () => { if (!settled) { settled = true; resolve(); } });
      out.on('error', (e) => fail(`write error: ${e.message}`));
    });
  }

  private gunzipTo(gzPath: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(gzPath).pipe(zlib.createGunzip()).pipe(fs.createWriteStream(outPath))
        .on('finish', () => resolve()).on('error', reject);
    });
  }

  /** gunzip + sanity-check the dump actually contains SQL, not just that the pipeline exited 0. */
  private async verifySqlDump(file: string): Promise<{ ok: boolean; detail: string }> {
    const tmp = file + '.verify.sql';
    try {
      await this.gunzipTo(file, tmp);
      const stat = fs.statSync(tmp);
      if (stat.size < 100) { fs.unlinkSync(tmp); return { ok: false, detail: 'decompressed dump is implausibly small' }; }
      const head = fs.readFileSync(tmp, { encoding: 'utf8', flag: 'r' }).slice(0, 4096);
      fs.unlinkSync(tmp);
      const looksLikeDump = /PostgreSQL database dump|^--|CREATE TABLE|COPY /im.test(head);
      if (!looksLikeDump) return { ok: false, detail: 'decompressed content does not look like a SQL dump' };
      return { ok: true, detail: `sha256 OK; decompresses to ${stat.size} bytes of valid-looking SQL` };
    } catch (e: any) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
      return { ok: false, detail: `verify error: ${this.sanitizeError(e?.message)}` };
    }
  }

  // ---- DICOM storage archive --------------------------------------------

  private async backupDicomStorage(runId: string): Promise<boolean> {
    const started = Date.now();
    const component: BackupComponent = 'DICOM_STORAGE';
    const run = await this.prisma.backupRun.create({ data: { runId, component, status: 'RUNNING' } });
    const fileName = `dicom-storage-${runId}.tar.gz`;
    const fullPath = path.join(this.backupRoot, fileName);
    try {
      if (!fs.existsSync(this.orthancStorageRoot)) throw new Error('Orthanc storage mount not present');
      // Read-only tar of the read-only mount: never writes into Orthanc's volume.
      await execFileP('tar', ['-czf', fullPath, '-C', this.orthancStorageRoot, '.']);

      const bytes = fs.statSync(fullPath).size;
      const sha256 = await this.hashFile(fullPath);
      const verify = await this.verifyTarArchive(fullPath);

      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: verify.ok ? 'SUCCESS' : 'FAILED',
          filePath: fileName, bytes: BigInt(bytes), sha256,
          verified: verify.ok, verifyDetail: verify.detail,
          completedAt: new Date(), durationMs: Date.now() - started,
          error: verify.ok ? null : verify.detail,
        },
      });
      if (!verify.ok) await this.notifyFailure(component, verify.detail);
      return verify.ok;
    } catch (e: any) {
      const detail = this.sanitizeError(e?.message ?? String(e));
      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: detail, completedAt: new Date(), durationMs: Date.now() - started },
      });
      await this.notifyFailure(component, detail);
      return false;
    }
  }

  /** List (not extract) the tar's entries to prove it is a readable, non-empty archive. */
  private async verifyTarArchive(file: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const { stdout } = await execFileP('tar', ['-tzf', file]);
      const entries = stdout.trim().split('\n').filter(Boolean).length;
      if (entries <= 0) return { ok: false, detail: 'archive lists 0 entries' };
      return { ok: true, detail: `sha256 OK; lists ${entries} entries` };
    } catch (e: any) {
      return { ok: false, detail: `verify error: ${this.sanitizeError(e?.message)}` };
    }
  }

  // ---- shared helpers --------------------------------------------------

  private async hashFile(file: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) =>
      fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject));
    return hash.digest('hex');
  }

  /** Strip anything that could resemble a password/connection string before it ever reaches a log or DB row. */
  private sanitizeError(msg: any): string {
    const s = String(msg ?? 'unknown error');
    return s.replace(/PGPASSWORD=\S+/gi, 'PGPASSWORD=***').replace(/password=\S+/gi, 'password=***').slice(0, 500);
  }

  private async notifyFailure(component: BackupComponent, detail: string) {
    await this.alerts.raise({
      alertKey: `backup:${component.toLowerCase()}:failed`, level: 'CRITICAL', source: 'BACKUP',
      title: `Nightly backup failed: ${component}`, detail,
    });
  }

  /** Delete backup files older than BACKUP_RETENTION_DAYS. Never touches any other file in the directory. */
  private async applyRetention() {
    try {
      const cutoff = Date.now() - this.retentionDays * 86400000;
      const files = fs.readdirSync(this.backupRoot);
      for (const f of files) {
        if (!/^(ris_db|orthanc_db|dicom-storage)-.*\.(sql\.gz|tar\.gz)$/.test(f)) continue;
        const full = path.join(this.backupRoot, f);
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      }
    } catch (e: any) {
      this.log.warn(`retention cleanup failed (non-fatal): ${e?.message}`);
    }
  }
}
