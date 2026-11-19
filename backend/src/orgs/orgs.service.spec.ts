import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { PaginationQuery } from '../common/pagination';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };
const orgUser: any = { id: 'u2', isSuperAdmin: false, organizationId: 'ORG1' };

function makePrisma() {
  return {
    organization: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;

describe('OrgsService', () => {
  let prisma: any;
  let svc: OrgsService;
  beforeEach(() => {
    prisma = makePrisma();
    svc = new OrgsService(prisma, audit);
    jest.clearAllMocks();
  });

  it('rejects duplicate org code on create', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'x' });
    await expect(svc.create(superUser, { code: 'GGH', name: 'X' } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates org and writes audit', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', code: 'NEW' });
    const res = await svc.create(superUser, { code: 'NEW', name: 'New Org' } as any);
    expect(res.code).toBe('NEW');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ORG_CREATE' }));
  });

  it('org-scoped user only sees own org in list', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.organization.count.mockResolvedValue(0);
    await svc.list(orgUser, new PaginationQuery());
    const whereArg = prisma.organization.findMany.mock.calls[0][0].where;
    expect(whereArg).toMatchObject({ id: 'ORG1' });
  });

  it('get throws NotFound when out of scope', async () => {
    prisma.organization.findFirst.mockResolvedValue(null);
    await expect(svc.get(orgUser, 'other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
