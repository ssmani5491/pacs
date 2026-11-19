import {
  Controller,
  All,
  Post,
  Req,
  Res,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { DicomWebService } from './dicomweb.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { AuditService } from '../audit/audit.service';
import { VIEWER_COOKIE } from '../auth/jwt.strategy';

/**
 * /api/dicom-web/*  — authenticated DICOMweb proxy consumed by OHIF.
 * /api/viewer/session — sets the HttpOnly cookie OHIF's image loader rides on.
 *
 * The JwtAuthGuard (global) authenticates every request here via the normal
 * Bearer header OR the viewer cookie (see jwt.strategy). study.view is required.
 */
@Controller()
export class DicomWebController {
  private readonly log = new Logger('DicomWebController');

  constructor(
    private svc: DicomWebService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  /**
   * Issue the viewer session cookie. The frontend calls this right before it
   * opens OHIF so the browser then sends the RIS access token automatically on
   * every DICOMweb request (including WADO-RS frame fetches that OHIF cannot
   * reliably header-authenticate). HttpOnly => not readable by viewer JS.
   */
  @Post('viewer/session')
  @RequirePermissions(PERMISSIONS.STUDY_VIEW)
  async openSession(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    // Reuse the exact access token the caller authenticated with (Bearer header).
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Viewer session requires a bearer token');

    const secure = (this.config.get<string>('COOKIE_SECURE') ?? 'false') === 'true';
    // Short-lived; refreshed whenever the viewer is reopened. Access-token TTL
    // governs real expiry server-side regardless of this maxAge.
    res.cookie(VIEWER_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/', // needs to cover both /viewer and /api/dicom-web
      maxAge: 1000 * 60 * 30, // 30 min
    });

    await this.audit.log({
      userId: user.id,
      action: 'VIEWER_SESSION_OPEN',
      ip: req.ip,
    });
    res.json({ ok: true });
  }

  @Post('viewer/session/close')
  @RequirePermissions(PERMISSIONS.STUDY_VIEW)
  closeSession(@Res() res: Response) {
    res.clearCookie(VIEWER_COOKIE, { path: '/' });
    res.json({ ok: true });
  }

  /**
   * DICOMweb passthrough. Matches every method/sub-path under /api/dicom-web.
   * We stream the upstream response verbatim so multipart WADO-RS pixel data is
   * delivered byte-for-byte with its boundary intact.
   */
  @All('dicom-web/*')
  @RequirePermissions(PERMISSIONS.STUDY_VIEW)
  async proxy(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    // Everything after '/api/dicom-web'
    const full = req.originalUrl; // e.g. /api/dicom-web/studies/1.2.3/series?...
    const afterPrefix = full.replace(/^\/api\/dicom-web/, '') || '/';
    const [pathPart, queryPart = ''] = afterPrefix.split('?');
    const query = new URLSearchParams(queryPart);

    // Collect raw body for STOW uploads only.
    let body: Buffer | undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await rawBody(req);
    }

    let upstream: globalThis.Response;
    try {
      upstream = await this.svc.proxy({
        user,
        method: req.method,
        subPath: pathPart,
        query,
        accept: (req.headers['accept'] as string) ?? undefined,
        contentType: (req.headers['content-type'] as string) ?? undefined,
        body,
      });
    } catch (e: any) {
      const status = e?.status ?? 502;
      // Audit denied study access attempts (org-isolation enforcement).
      if (status === 403 || status === 404) {
        await this.audit.log({
          userId: user.id,
          action: 'VIEWER_STUDY_ACCESS_DENIED',
          detail: { path: pathPart, reason: e?.message },
          ip: req.ip,
        });
      }
      res.status(status).json({ message: e?.message ?? 'DICOMweb proxy error' });
      return;
    }

    // Audit successful study-metadata opens (not every frame, to avoid noise):
    // the first metadata GET for a study is a good proxy for "opened study".
    if (req.method === 'GET' && /\/studies\/[0-9.]+\/metadata$/.test(pathPart)) {
      const uid = pathPart.match(/\/studies\/([0-9.]+)\//)?.[1];
      await this.audit.log({
        userId: user.id,
        action: 'VIEWER_STUDY_OPEN',
        entityType: 'Study',
        entityId: uid,
        ip: req.ip,
      });
    }

    // Mirror status + content headers and stream the body.
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    // Let the browser cache immutable pixel data briefly (perf; Module 9).
    if (/\/frames\/|\/bulkdata\/|rendered/.test(pathPart)) {
      res.setHeader('Cache-Control', 'private, max-age=300');
    }

    if (!upstream.body) {
      res.end();
      return;
    }
    // Stream Web ReadableStream -> Node response.
    Readable.fromWeb(upstream.body as any).pipe(res);
  }
}

/** Buffer a request body (STOW uploads). */
function rawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
