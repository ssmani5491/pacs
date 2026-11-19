import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };
const orgUser: any = { id: 'u2', isSuperAdmin: false, organizationId: 'ORG1' };

function makePrisma() {
  return {
    department: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;

describe('DepartmentsService', () => {
  let prisma: any; let svc: DepartmentsService;
  beforeEach(() => { prisma = makePrisma(); svc = new DepartmentsService(prisma, audit); jest.clearAllMocks(); });

  it('blocks a non-super user from creating a department in another org', async () => {
    await expect(
      svc.create(orgUser, { organizationId: 'ORG2', code: 'RAD', name: 'Radiology' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects duplicate code within the same org', async () => {
    prisma.department.findFirst.mockResolvedValue({ id: 'd0' });
    await expect(
      svc.create(orgUser, { organizationId: 'ORG1', code: 'RAD', name: 'Radiology' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows super admin to create in any org', async () => {
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.create.mockResolvedValue({ id: 'd1', code: 'RAD' });
    const res = await svc.create(superUser, { organizationId: 'ORGX', code: 'RAD', name: 'Radiology' } as any);
    expect(res.code).toBe('RAD');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPT_CREATE' }));
  });
});
