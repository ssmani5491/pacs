import { ConflictException } from '@nestjs/common';
import { ModalitiesService } from './modalities.service';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };

function makePrisma() {
  return {
    modalityDevice: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;
function makeOrthanc() {
  return { putModality: jest.fn(), echoModality: jest.fn(), deleteModality: jest.fn() } as any;
}

describe('ModalitiesService', () => {
  let prisma: any; let orthanc: any; let svc: ModalitiesService;
  beforeEach(() => { prisma = makePrisma(); orthanc = makeOrthanc(); svc = new ModalitiesService(prisma, audit, orthanc); jest.clearAllMocks(); });

  it('rejects duplicate AE title', async () => {
    prisma.modalityDevice.findFirst.mockResolvedValue({ id: 'm0' });
    await expect(svc.create(superUser, { name: 'CT1', aeTitle: 'CT_AE', host: '10.0.0.1', port: 104, modalityType: 'CT' } as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a modality and audits it', async () => {
    prisma.modalityDevice.findFirst.mockResolvedValue(null);
    prisma.modalityDevice.create.mockResolvedValue({ id: 'm1', aeTitle: 'CT_AE' });
    const res = await svc.create(superUser, { name: 'CT1', aeTitle: 'CT_AE', host: '10.0.0.1', port: 104, modalityType: 'CT' } as any);
    expect(res.aeTitle).toBe('CT_AE');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'MODALITY_CREATE' }));
  });

  describe('testConnection', () => {
    // TEST-NET-1 (RFC 5737) silently drops the connection attempt rather
    // than actively refusing it, so this reaches the probe's own timeout
    // (TCP_TIMEOUT) — both TCP_TIMEOUT and TCP_UNREACHABLE share the same
    // important behavior under test here: neither ever calls Orthanc, and
    // neither is the old hard-coded "unreachable" literal.
    it('reports a TCP failure outcome and never calls Orthanc when the TCP probe fails', async () => {
      prisma.modalityDevice.findFirst.mockResolvedValue({ id: 'm1', host: '192.0.2.1', port: 1, aeTitle: 'X' });
      const res = await svc.testConnection(superUser, 'm1');
      expect(['TCP_UNREACHABLE', 'TCP_TIMEOUT']).toContain(res.outcome);
      expect(res.detail).not.toBe('unreachable'); // never the old hard-coded literal
      expect(orthanc.putModality).not.toHaveBeenCalled();
    }, 10000);

    it('returns ECHO_SUCCESS and cleans up when Orthanc echo succeeds', async () => {
      // There's no reachable test server to TCP-connect to in this unit test,
      // so stub the private tcpProbe step directly and verify the outcome
      // mapping + Orthanc call contract that follows it.
      const svcWithStubbedTcp: any = svc;
      svcWithStubbedTcp.tcpProbe = jest.fn().mockResolvedValue({ ok: true, detail: 'TCP connect OK' });
      prisma.modalityDevice.findFirst.mockResolvedValue({ id: 'm1', host: '10.0.0.1', port: 104, aeTitle: 'X' });
      orthanc.echoModality.mockResolvedValue({ ok: true, elapsedMs: 42 });

      const res = await svc.testConnection(superUser, 'm1');
      expect(res.outcome).toBe('ECHO_SUCCESS');
      expect(res.detail).toContain('42ms');
      expect(orthanc.putModality).toHaveBeenCalledWith('modtest_m1', 'X', '10.0.0.1', 104);
      expect(orthanc.deleteModality).toHaveBeenCalledWith('modtest_m1');
    });

    it('classifies a rejected association distinctly from a timeout', async () => {
      const svcWithStubbedTcp: any = svc;
      svcWithStubbedTcp.tcpProbe = jest.fn().mockResolvedValue({ ok: true, detail: 'TCP connect OK' });
      prisma.modalityDevice.findFirst.mockResolvedValue({ id: 'm1', host: '10.0.0.1', port: 104, aeTitle: 'X' });
      orthanc.echoModality.mockResolvedValue({ ok: false, elapsedMs: 5, reason: 'rejected', detail: 'Association rejected: calling AE not recognized' });

      const res = await svc.testConnection(superUser, 'm1');
      expect(res.outcome).toBe('ASSOCIATION_REJECTED');
      expect(res.detail).toContain('Association rejected');
    });

    it('always deregisters the temporary modality even when echoModality throws', async () => {
      const svcWithStubbedTcp: any = svc;
      svcWithStubbedTcp.tcpProbe = jest.fn().mockResolvedValue({ ok: true, detail: 'TCP connect OK' });
      prisma.modalityDevice.findFirst.mockResolvedValue({ id: 'm1', host: '10.0.0.1', port: 104, aeTitle: 'X' });
      orthanc.echoModality.mockRejectedValue(new Error('boom'));

      const res = await svc.testConnection(superUser, 'm1');
      expect(res.outcome).toBe('ECHO_ERROR');
      expect(orthanc.deleteModality).toHaveBeenCalledWith('modtest_m1');
    });
  });
});
