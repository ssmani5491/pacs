import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };

function makePrisma() {
  return {
    scheduledOrder: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    patient: { findFirst: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;

describe('OrdersService', () => {
  let prisma: any; let svc: OrdersService;
  beforeEach(() => { prisma = makePrisma(); svc = new OrdersService(prisma, audit, { create: jest.fn().mockResolvedValue([]) } as any); jest.clearAllMocks(); });

  it('generates a unique dated accession number', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    prisma.scheduledOrder.count.mockResolvedValue(0);
    prisma.scheduledOrder.findUnique.mockResolvedValue(null); // accession free
    prisma.scheduledOrder.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'ord1', ...data }));
    const res: any = await svc.create(superUser, { patientId: 'p1', modalityType: 'CT', procedureDesc: 'Head CT', scheduledAt: new Date().toISOString() } as any);
    expect(res.accessionNumber).toMatch(/^\d{8}\d{6}$/); // YYYYMMDD + 6 digits
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ORDER_CREATE' }));
  });

  it('retries accession on collision', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    prisma.scheduledOrder.count.mockResolvedValue(0);
    prisma.scheduledOrder.findUnique
      .mockResolvedValueOnce({ id: 'taken' }) // first candidate taken
      .mockResolvedValueOnce(null);           // second free
    prisma.scheduledOrder.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'ord2', ...data }));
    const res: any = await svc.create(superUser, { patientId: 'p1', modalityType: 'MR', procedureDesc: 'Brain MRI', scheduledAt: new Date().toISOString() } as any);
    expect(res.accessionNumber).toMatch(/000002$/);
  });

  it('rejects order for out-of-scope patient', async () => {
    prisma.patient.findFirst.mockResolvedValue(null);
    await expect(svc.create(superUser, { patientId: 'nope', modalityType: 'CT', procedureDesc: 'x', scheduledAt: new Date().toISOString() } as any))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
