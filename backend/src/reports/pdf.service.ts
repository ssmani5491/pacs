import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { ReportsService } from './reports.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';

/**
 * Server-side PDF generation (Phase 7, Module 7). Rendered behind the
 * authenticated, org-isolated reports API; access is audited. Uses pdfkit (no
 * headless browser). Includes hospital config, patient/exam details, report
 * body, signature info, version, accession, and any addenda.
 */
@Injectable()
export class PdfService {
  private readonly log = new Logger('PdfService');

  constructor(
    private reports: ReportsService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  private hospital() {
    return {
      name: this.config.get<string>('INSTITUTION_NAME') ?? 'GG Hospital',
      // logo path is optional; configured via env REPORT_LOGO_PATH
      logo: this.config.get<string>('REPORT_LOGO_PATH') ?? '',
    };
  }

  async generate(user: AuthUser, reportId: string, ip?: string): Promise<{ buffer: Buffer; filename: string }> {
    // getById enforces REPORT_VIEW + org isolation.
    const r: any = await this.reports.getById(user, reportId);
    const hosp = this.hospital();
    const patient = r.study?.patient;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // ---- Header ----
    if (hosp.logo) {
      try { doc.image(hosp.logo, 50, 40, { height: 40 }); } catch { /* ignore missing logo */ }
    }
    doc.fontSize(18).font('Helvetica-Bold').text(hosp.name, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('Radiology Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.6);

    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(9).text(label, { continued: true, width: 120 });
      doc.font('Helvetica').fontSize(9).text('  ' + (value || '—'));
    };

    // ---- Patient + exam ----
    doc.font('Helvetica-Bold').fontSize(11).text('Patient & Examination');
    doc.moveDown(0.2);
    row('Patient Name:', patient?.name ?? '—');
    row('MRN:', patient?.mrn ?? '—');
    row('DOB / Sex:', `${patient?.dob ? new Date(patient.dob).toLocaleDateString() : '—'}  /  ${patient?.gender ?? '—'}`);
    row('Accession No:', r.study?.accessionNumber ?? '—');
    row('Modality:', r.study?.modality ?? '—');
    row('Study Desc:', r.study?.description ?? '—');
    row('Study Date:', r.study?.studyDate ? new Date(r.study.studyDate).toLocaleString() : '—');
    doc.moveDown(0.5);

    // ---- Report body ----
    const section = (title: string, body?: string | null) => {
      if (!body) return;
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11).text(title);
      doc.font('Helvetica').fontSize(10).text(body, { align: 'left' });
    };
    section('Clinical History', r.clinicalHistory);
    section('Technique', r.technique);
    section('Comparison', r.comparison);
    section('Findings', r.findings);
    section('Impression', r.impression);
    section('Recommendations', r.recommendations);

    // ---- Addenda ----
    if (r.addenda?.length) {
      for (const a of r.addenda) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#b00').text(`ADDENDUM (v${a.version}, ${a.status})`);
        doc.fillColor('black');
        section('Addendum Findings', a.findings);
        section('Addendum Impression', a.impression);
        section('Addendum Recommendations', a.recommendations);
      }
    }

    // ---- Signature / status footer ----
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.4);
    const sig = r.signatures?.[r.signatures.length - 1];
    row('Report Status:', r.status);
    row('Report Version:', String(r.version));
    row('Reporting Radiologist:', r.author?.fullName ?? '—');
    if (r.author?.designation) row('Qualification:', r.author.designation);
    if (sig) {
      row('Signed By:', sig.user?.fullName ?? '—');
      row('Signed At (server):', new Date(sig.signedAt).toLocaleString());
      row('Signature Method:', 'Authenticated electronic approval (not a legally recognised digital signature)');
      row('Signature Verification:', sig.verification ?? '—');
      row('Signature Hash:', (sig.signatureHash ?? '').slice(0, 32) + '…');
    } else {
      row('Signature:', 'UNSIGNED');
    }
    doc.moveDown(0.5);
    doc.fontSize(7).fillColor('#666').text(
      'Generated for synthetic test data. Electronic approval recorded above is an authenticated ' +
      'sign-off, not a legally accredited digital signature.',
      { align: 'center' },
    );

    doc.end();
    const buffer = await done;

    await this.audit.log({
      userId: user.id, action: 'REPORT_PDF_DOWNLOAD', entityType: 'Report', entityId: reportId, ip,
    });
    const acc = r.study?.accessionNumber ?? reportId.slice(0, 8);
    return { buffer, filename: `report_${acc}_v${r.version}.pdf` };
  }
}
