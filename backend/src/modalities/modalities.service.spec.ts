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

describe('ModalitiesService', () => {
  let prisma: any; let svc: ModalitiesService;
  beforeEach(() => { prisma = makePrisma(); svc = new ModalitiesService(prisma, audit); jest.clearAllMocks(); });

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
});
