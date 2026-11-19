import { IngestService } from './ingest.service';

// Orthanc study fixture with 1 series / 2 instances.
function orthancFixtures(accession = 'ACC123', patientId = 'DCMPID1') {
  const study = {
    ID: 'orthanc-study-1',
    MainDicomTags: {
      StudyInstanceUID: '1.2.3.4.5', AccessionNumber: accession,
      StudyDate: '20261113', StudyTime: '101500', StudyDescription: 'HEAD CT',
      ModalitiesInStudy: 'CT',
    },
    PatientMainDicomTags: { PatientID: patientId, PatientName: 'DOE^JOHN', PatientSex: 'M', PatientBirthDate: '19900101' },
  };
  const series = [{ ID: 'ser1' }];
  const seriesDetail = {
    MainDicomTags: { SeriesInstanceUID: '1.2.3.4.5.1', Modality: 'CT', SeriesNumber: '1', SeriesDescription: 'AXIAL' },
    Instances: ['inst1', 'inst2'],
  };
  const instTags: Record<string, any> = {
    inst1: { SOPInstanceUID: '1.2.3.4.5.1.1', InstanceNumber: '1' },
    inst2: { SOPInstanceUID: '1.2.3.4.5.1.2', InstanceNumber: '2' },
  };
  return { study, series, seriesDetail, instTags };
}

function makeMocks(fx: any) {
  const orthanc = {
    getStudy: jest.fn().mockResolvedValue(fx.study),
    getStudySeries: jest.fn().mockResolvedValue(fx.series),
    getSeries: jest.fn().mockResolvedValue(fx.seriesDetail),
    getInstanceTags: jest.fn((id: string) => Promise.resolve(fx.instTags[id])),
  } as any;

  const log = { id: 'log1' };
  const prisma: any = {
    dicomReceptionLog: { create: jest.fn().mockResolvedValue(log), update: jest.fn() },
    scheduledOrder: { findUnique: jest.fn(), update: jest.fn() },
    patient: { findFirst: jest.fn(), create: jest.fn() },
    study: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    series: { upsert: jest.fn().mockResolvedValue({ id: 'seriesRow1' }) },
    instance: { upsert: jest.fn() },
  };
  const audit = { log: jest.fn() } as any;
  return { orthanc, prisma, audit };
}

describe('IngestService', () => {
  it('matches an order by accession and ingests Patient→Study→Series→Instance', async () => {
    const fx = orthancFixtures('ACC123');
    const { orthanc, prisma, audit } = makeMocks(fx);
    prisma.scheduledOrder.findUnique.mockResolvedValue({ id: 'ord1', patientId: 'pat1', organizationId: 'org1' });
    prisma.study.findUnique.mockResolvedValue(null); // new study
    prisma.study.create.mockResolvedValue({ id: 'studyRow1' });

    const svc = new IngestService(prisma, audit, orthanc, { create: jest.fn().mockResolvedValue([]) } as any);
    const res = await svc.ingestOrthancStudy('orthanc-study-1');

    expect(res.isOrphan).toBe(false);
    expect(res.instances).toBe(2);
    // did NOT create a provisional patient (matched order's patient used)
    expect(prisma.patient.create).not.toHaveBeenCalled();
    // order marked completed
    expect(prisma.scheduledOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    // instances deduped via upsert on SOP UID
    expect(prisma.instance.upsert).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STUDY_INGESTED' }));
    expect(prisma.dicomReceptionLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'INGESTED', instanceCount: 2 }),
    }));
  });

  it('creates a provisional orphan when no order/patient matches', async () => {
    const fx = orthancFixtures('NOORDER');
    const { orthanc, prisma, audit } = makeMocks(fx);
    prisma.scheduledOrder.findUnique.mockResolvedValue(null);
    prisma.patient.findFirst.mockResolvedValue(null);  // no patient match
    prisma.patient.create.mockResolvedValue({ id: 'provisional1' });
    prisma.study.findUnique.mockResolvedValue(null);
    prisma.study.create.mockResolvedValue({ id: 'studyRow2' });

    const svc = new IngestService(prisma, audit, orthanc, { create: jest.fn().mockResolvedValue([]) } as any);
    const res = await svc.ingestOrthancStudy('orthanc-study-1');

    expect(res.isOrphan).toBe(true);
    expect(prisma.patient.create).toHaveBeenCalled(); // provisional patient
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STUDY_ORPHAN' }));
    expect(prisma.study.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isOrphan: true, isReconciled: false }),
    }));
  });

  it('logs FAILED when the study has no StudyInstanceUID', async () => {
    const fx = orthancFixtures();
    fx.study.MainDicomTags.StudyInstanceUID = '';
    const { orthanc, prisma, audit } = makeMocks(fx);
    const svc = new IngestService(prisma, audit, orthanc, { create: jest.fn().mockResolvedValue([]) } as any);
    await expect(svc.ingestOrthancStudy('bad')).rejects.toThrow();
    expect(prisma.dicomReceptionLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });
});
