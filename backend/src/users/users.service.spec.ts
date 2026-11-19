import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

const superUser: any = { id: 'admin', isSuperAdmin: true, organizationId: null };

function makePrisma() {
  return {
    user: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    role: { findMany: jest.fn() },
    userRole: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;
const auth = { hashPassword: jest.fn().mockResolvedValue('HASH'), logout: jest.fn() } as any;

describe('UsersService', () => {
  let prisma: any; let svc: UsersService;
  beforeEach(() => { prisma = makePrisma(); svc = new UsersService(prisma, audit, auth); jest.clearAllMocks(); });

  it('rejects duplicate username/email', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'x' });
    await expect(svc.create(superUser, { username: 'a', email: 'a@b.c', password: 'password1', fullName: 'A' } as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('hashes password and assigns roles on create', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.role.findMany.mockResolvedValue([{ id: 'r1' }]);
    prisma.user.create.mockResolvedValue({ id: 'u1', username: 'a' });
    await svc.create(superUser, { username: 'a', email: 'a@b.c', password: 'password1', fullName: 'A', roleKeys: ['radiologist'] } as any);
    expect(auth.hashPassword).toHaveBeenCalledWith('password1');
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.passwordHash).toBe('HASH');
    expect(data.roles.create).toEqual([{ roleId: 'r1' }]);
    // never store the raw password
    expect(data.password).toBeUndefined();
  });

  it('prevents self-deactivation', async () => {
    await expect(svc.setActive(superUser, 'admin', false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
