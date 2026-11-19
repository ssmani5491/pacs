import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';

/**
 * Authenticated DICOMweb proxy to Orthanc.
 *
 * OHIF (in the browser) must never hold Orthanc credentials and must only ever
 * reach studies its logged-in RIS user is allowed to see. Every QIDO/WADO/STOW
 * request therefore goes through here:
 *   browser --(RIS session cookie/JWT)--> /api/dicom-web/* --> Orthanc (basic auth)
 *
 * Responsibilities:
 *  - inject Orthanc's server-side basic-auth (kept in env, never sent to the client)
 *  - enforce organization isolation: a user may only access a StudyInstanceUID
 *    that belongs to a Study row in their organization (super admin sees all)
 *  - stream responses verbatim (crucial for multipart WADO-RS pixel data)
 */
@Injectable()
export class DicomWebService {
  private readonly log = new Logger('DicomWebService');
  private base: string;
  private authHeader: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    // Orthanc's own DICOMweb root (server-to-server, inside the docker network).
    this.base = (config.get<string>('ORTHANC_URL') ?? 'http://orthanc:8042').replace(/\/$/, '');
    const user = config.get<string>('ORTHANC_USERNAME') ?? 'orthanc';
    const pass = config.get<string>('ORTHANC_PASSWORD') ?? '';
    this.authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  /**
   * Returns the set of StudyInstanceUIDs the user is allowed to access, or null
   * meaning "no restriction" (super admin). Used to scope QIDO study searches.
   */
  private async allowedStudyFilter(user: AuthUser): Promise<string[] | null> {
    if (user.isSuperAdmin) return null;
    const rows = await this.prisma.study.findMany({
      where: { organizationId: user.organizationId ?? '__none__' },
      select: { studyInstanceUid: true },
    });
    return rows.map((r) => r.studyInstanceUid);
  }

  /**
   * Authorize access to one specific StudyInstanceUID. Throws if the study is
   * unknown to the RIS or belongs to another organization.
   */
  async assertStudyAccess(user: AuthUser, studyInstanceUid: string): Promise<void> {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyInstanceUid },
      select: { organizationId: true },
    });
    if (!study) throw new NotFoundException('Study not found');
    if (user.isSuperAdmin) return;
    if (!study.organizationId || study.organizationId !== user.organizationId) {
      throw new ForbiddenException('Study belongs to another organization');
    }
  }

  /**
   * Extract a StudyInstanceUID from a DICOMweb sub-path if the path targets a
   * specific study (WADO-RS /studies/{uid}/... or QIDO ?StudyInstanceUID=...).
   * Returns null for collection-level requests (e.g. GET /studies search).
   */
  studyUidFromPath(path: string, query: URLSearchParams): string | null {
    // /studies/<uid>/...  (also /studies/<uid>/metadata, /series, /instances, frames)
    const m = path.match(/\/studies\/([0-9.]+)(?:\/|$)/);
    if (m) return m[1];
    // QIDO filter form
    const q = query.get('StudyInstanceUID') ?? query.get('0020000D');
    if (q) return q;
    return null;
  }

  /**
   * Core proxy. `subPath` is everything after /api/dicom-web (already includes a
   * leading slash), `method`, request `headers` (we forward Accept), optional
   * request `body` (for STOW). Returns a native fetch Response so the controller
   * can stream it back with the right content-type (incl. multipart boundaries).
   */
  async proxy(opts: {
    user: AuthUser;
    method: string;
    subPath: string;
    query: URLSearchParams;
    accept?: string;
    contentType?: string;
    body?: Buffer;
  }): Promise<Response> {
    const { user, method, subPath, query } = opts;

    // ---- Authorization -----------------------------------------------------
    const isQidoStudyList = /\/studies\/?$/.test(subPath.split('?')[0]) && method === 'GET';
    // For a QIDO study-list search by a non-super-admin, compute the org allow-set
    // ONCE here and reuse it for the post-filter below (Phase 9 PERF-1 fix: was
    // queried twice per request — a full scan of the org's studies each time).
    let allowedSet: Set<string> | null = null;

    const targetStudy = this.studyUidFromPath(subPath, query);
    if (targetStudy) {
      // Any request scoped to a specific study must pass the org check.
      await this.assertStudyAccess(user, targetStudy);
    } else if (isQidoStudyList && !user.isSuperAdmin) {
      const allowed = await this.allowedStudyFilter(user);
      if (allowed !== null) {
        allowedSet = new Set(allowed);
        if (allowedSet.size === 0) {
          // No studies in this org -> return an empty QIDO result without hitting Orthanc.
          return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/dicom+json' },
          });
        }
        // Orthanc QIDO does not accept a list of UIDs in one param; we post-filter.
      }
    } else if (method === 'POST' || method === 'PUT') {
      // STOW-RS upload — gate behind study.view already enforced by the guard;
      // uploads land in Orthanc and are reconciled by the existing ingest flow.
    }

    // ---- Build upstream URL ------------------------------------------------
    const qs = query.toString();
    const url = `${this.base}/dicom-web${subPath.split('?')[0]}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = { Authorization: this.authHeader };
    if (opts.accept) headers['Accept'] = opts.accept;
    if (opts.contentType) headers['Content-Type'] = opts.contentType;

    const init: RequestInit = { method, headers };
    if (opts.body && (method === 'POST' || method === 'PUT')) {
      // Buffer -> Uint8Array for fetch's BodyInit typing.
      init.body = new Uint8Array(opts.body);
    }

    const res = await fetch(url, init);

    // ---- Post-filter QIDO study search for org isolation -------------------
    // Reuse the allow-set computed above (single DB scan per request, not two).
    if (
      allowedSet !== null &&
      isQidoStudyList &&
      (res.headers.get('content-type') ?? '').includes('json')
    ) {
      const all = (await res.json()) as any[];
      const filtered = all.filter((entry) => {
        const uid = entry?.['0020000D']?.Value?.[0];
        return uid && allowedSet!.has(uid);
      });
      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: { 'content-type': 'application/dicom+json' },
      });
    }

    return res;
  }
}
