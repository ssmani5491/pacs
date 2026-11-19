import { ConflictException, BadRequestException } from '@nestjs/common';
import { PatientsService } from './patients.service';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };

function makePrisma() {
  return {
    patient: {
      findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(),
      count: jest.fn(), create: jest.fn(), update: jest.fn(),
    },
    organization: { findUnique: jest.fn() },
    study: { updateMany: jest.fn() },
    scheduledOrder: { updateMany: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;

describe('PatientsService', () => {
  let prisma: any; let svc: PatientsService;
  beforeEach(() => { prisma = makePrisma(); svc = new PatientsService(prisma, audit); jest.clearAllMocks(); });

  it('blocks a duplicate patient unless overridden', async () => {
    prisma.patient.findMany.mockResolvedValue([{ id: 'p0', mrn: 'GG00000001', name: 'John Doe' }]);
    await expect(svc.create(superUser, { name: 'John Doe', gender: 'M' } as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('creates when allowDuplicate is set, auto-generating an MRN', async () => {
    prisma.patient.findMany.mockResolvedValue([{ id: 'p0' }]); // duplicates exist but overridden
    prisma.organization.findUnique.mockResolvedValue({ code: 'GGH' });
    prisma.patient.count.mockResolvedValue(5);
    prisma.patient.findFirst.mockResolvedValue(null);   // mrn free
    prisma.patient.create.mockResolvedValue({ id: 'p1', mrn: 'GGH00000006', dob: null });
    const res = await svc.create(superUser, { name: 'John Doe', organizationId: 'o1', allowDuplicate: true } as any);
    expect(res.mrn).toMatch(/^GGH\d{8}$/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PATIENT_CREATE' }));
  });

  it('computes age from dob', async () => {
    prisma.patient.findMany.mockResolvedValue([]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.patient.count.mockResolvedValue(0);
    prisma.patient.findFirst.mockResolvedValue(null);
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 30);
    prisma.patient.create.mockResolvedValue({ id: 'p2', mrn: 'GG00000001', dob });
    const res: any = await svc.create(superUser, { name: 'Age Test', allowDuplicate: true } as any);
    expect(res.age).toBe(30);
  });

  it('rejects self-merge', async () => {
    await expect(svc.merge(superUser, 'same', 'same')).rejects.toBeInstanceOf(BadRequestException);
  });
});
