import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { NotificationsService } from '../notifications/notifications.service';

// Parse DICOM DA (YYYYMMDD) into a Date.
function parseDA(da?: string): Date | undefined {
  if (!da || da.length < 8) return undefined;
  const y = +da.slice(0, 4), m = +da.slice(4, 6), d = +da.slice(6, 8);
  if (!y || !m || !d) return undefined;
  return new Date(Date.UTC(y, m - 1, d));
}

@Injectable()
export class IngestService {
  private readonly log = new Logger('IngestService');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private orthanc: OrthancService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Ingest one Orthanc study into the RIS DB. Called by on-stored.lua when a
   * study becomes stable. Idempotent: re-ingesting updates counts, never
   * silently overwrites patient/order identity.
   */
  async ingestOrthancStudy(orthancStudyId: string) {
    const startLog = await this.prisma.dicomReceptionLog.create({
      data: { orthancStudyId, status: 'RECEIVED' },
    });

    try {
      const study = await this.orthanc.getStudy(orthancStudyId);
      const tags = { ...(study.MainDicomTags ?? {}), ...(study.PatientMainDicomTags ?? {}) };

      const studyInstanceUid: string = tags.StudyInstanceUID;
      const accessionNumber: string | undefined = tags.AccessionNumber || undefined;
      const dicomPatientId: string | undefined = tags.PatientID || undefined;
      const patientName: string = (tags.PatientName || 'UNKNOWN').replace(/\^/g, ' ').trim();
      let modality: string | undefined = tags.ModalitiesInStudy || tags.Modality || undefined;

      if (!studyInstanceUid) throw new Error('Study has no StudyInstanceUID');

      // ---- Match / create patient (never silent overwrite) ----
      let patientId: string | null = null;
      let orgId: string | null = null;
      // Try accession -> RIS order first (authoritative link)
      let matchedOrder = accessionNumber
        ? await this.prisma.scheduledOrder.findUnique({ where: { accessionNumber } })
        : null;

      if (matchedOrder) {
        patientId = matchedOrder.patientId;
        orgId = matchedOrder.organizationId;
      } else if (dicomPatientId) {
        // Match on DICOM patient id / MRN
        const p = await this.prisma.patient.findFirst({
          where: { OR: [{ dicomPatientId }, { mrn: dicomPatientId }] },
        });
        if (p) { patientId = p.id; orgId = p.organizationId; }
      }

      const isOrphan = !patientId;
      // For orphans, create a provisional patient record flagged for reconciliation.
      if (!patientId) {
        const provisional = await this.prisma.patient.create({
          data: {
            mrn: dicomPatientId || `UNMATCHED-${studyInstanceUid.slice(-12)}`,
            dicomPatientId, name: patientName || 'UNKNOWN',
            gender: tags.PatientSex || undefined,
            dob: parseDA(tags.PatientBirthDate),
            status: 'ACTIVE',
          },
        });
        patientId = provisional.id;
      }

      // ---- Upsert study (match on StudyInstanceUID; never duplicate) ----
      const existing = await this.prisma.study.findUnique({ where: { studyInstanceUid } });
      const studyData = {
        orthancStudyId,
        accessionNumber,
        studyDate: parseDA(tags.StudyDate),
        studyTime: tags.StudyTime || undefined,
        description: tags.StudyDescription || undefined,
        modality,
        patientId,
        organizationId: orgId,
        isOrphan,
        isReconciled: !isOrphan,
        searchText: `${patientName} ${accessionNumber ?? ''} ${tags.StudyDescription ?? ''}`,
      };

      const studyRow = existing
        ? await this.prisma.study.update({ where: { studyInstanceUid }, data: studyData })
        : await this.prisma.study.create({ data: { studyInstanceUid, ...studyData } });

      // ---- Series + instances ----
      const seriesIds: string[] = await this.orthanc.getStudySeries(orthancStudyId)
        .then((arr: any[]) => arr.map((s) => s.ID));
      let totalInstances = 0;
      for (const sId of seriesIds) {
        const s = await this.orthanc.getSeries(sId);
        const st = s.MainDicomTags ?? {};
        const seriesUid = st.SeriesInstanceUID;
        if (!seriesUid) continue;
        // Study-level modality isn't always in study tags; derive from first series.
        if (!modality && st.Modality) modality = st.Modality;
        const instIds: string[] = s.Instances ?? [];
        totalInstances += instIds.length;

        const seriesRow = await this.prisma.series.upsert({
          where: { seriesInstanceUid: seriesUid },
          update: { instanceCount: instIds.length, modality: st.Modality, description: st.SeriesDescription },
          create: {
            studyId: studyRow.id, seriesInstanceUid: seriesUid,
            seriesNumber: st.SeriesNumber ? +st.SeriesNumber : undefined,
            modality: st.Modality, description: st.SeriesDescription,
            instanceCount: instIds.length,
          },
        });

        // Register instances (dedupe on SOP Instance UID)
        for (const instId of instIds) {
          const itags = await this.orthanc.getInstanceTags(instId).catch(() => ({}));
          const sop = itags.SOPInstanceUID;
          if (!sop) continue;
          await this.prisma.instance.upsert({
            where: { sopInstanceUid: sop },
            update: { orthancId: instId },
            create: {
              seriesId: seriesRow.id, sopInstanceUid: sop,
              instanceNumber: itags.InstanceNumber ? +itags.InstanceNumber : undefined,
              orthancId: instId,
            },
          });
        }
      }

      // image count + derived modality
      await this.prisma.study.update({ where: { id: studyRow.id }, data: { imageCount: totalInstances, modality } });

      // ---- Mark order arrived ----
      if (matchedOrder) {
        await this.prisma.scheduledOrder.update({
          where: { id: matchedOrder.id },
          data: { status: 'COMPLETED', studyInstanceUid, studyId: studyRow.id },
        });
      }

      const status = isOrphan ? 'ORPHAN' : (existing ? 'MATCHED' : 'INGESTED');
      await this.prisma.dicomReceptionLog.update({
        where: { id: startLog.id },
        data: {
          status, studyInstanceUid, accessionNumber, modality,
          seriesCount: seriesIds.length, instanceCount: totalInstances,
          message: isOrphan ? 'No matching order/patient — queued for reconciliation' : 'OK',
        },
      });
      await this.audit.log({
        action: isOrphan ? 'STUDY_ORPHAN' : 'STUDY_INGESTED',
        entityType: 'Study', entityId: studyRow.id,
        detail: { studyInstanceUid, accessionNumber, series: seriesIds.length, instances: totalInstances, isOrphan },
      });

      // ---- Notifications (Phase 8) — after the successful DB work; never throws.
      if (isOrphan) {
        await this.notifications.create({
          category: 'ORPHAN_STUDY', priority: 'HIGH', roleKey: 'pacs_admin',
          organizationId: orgId, studyId: studyRow.id,
          dedupKey: `orphan:${studyRow.id}`,
          title: 'Unmatched study received',
          body: `A study arrived without a matching order/patient and needs reconciliation${accessionNumber ? ` (acc ${accessionNumber})` : ''}.`,
          link: '/pacs/reconciliation',
        });
      } else if (!existing) {
        await this.notifications.create({
          category: 'STUDY_MATCHED', priority: 'NORMAL', roleKey: 'radiologist',
          organizationId: orgId, studyId: studyRow.id,
          dedupKey: `new-study:${studyRow.id}`,
          title: 'New study received',
          body: `${modality ?? 'Study'} received${accessionNumber ? ` for accession ${accessionNumber}` : ''}.`,
          link: '/reporting',
        });
      }

      this.log.log(`Ingested study ${studyInstanceUid} (${status}, ${totalInstances} instances)`);
      return { studyId: studyRow.id, status, instances: totalInstances, isOrphan };
    } catch (e: any) {
      await this.prisma.dicomReceptionLog.update({
        where: { id: startLog.id },
        data: { status: 'FAILED', message: e.message?.slice(0, 500) },
      });
      await this.audit.log({ action: 'DICOM_INGEST_FAILED', status: 'FAILURE', entityType: 'Study', detail: { orthancStudyId, error: e.message } });
      await this.notifications.create({
        category: 'DICOM_FAILURE', priority: 'HIGH', roleKey: 'pacs_admin',
        dedupKey: `dicom-fail:${orthancStudyId}`,
        title: 'DICOM reception failure',
        body: `Ingest failed for an incoming study. See reception logs.`,
        link: '/pacs/reception-logs',
      });
      this.log.error(`Ingest failed for ${orthancStudyId}: ${e.message}`);
      throw e;
    }
  }
}
