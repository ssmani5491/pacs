import { NotificationsService } from './notifications.service';

// Minimal Prisma + gateway mocks.
function makePrisma() {
  return {
    notification: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    notificationDeliveryAttempt: { create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const gateway = { emitToRecipient: jest.fn().mockReturnValue(true) } as any;

describe('NotificationsService', () => {
  let prisma: any; let svc: NotificationsService;
  beforeEach(() => { prisma = makePrisma(); svc = new NotificationsService(prisma, gateway); jest.clearAllMocks(); });

  it('creates a user-targeted notification', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'n1', userId: 'u1' });
    const res = await svc.create({ category: 'EXAM_ASSIGNED', title: 'x', userId: 'u1' });
    expect(res).toHaveLength(1);
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('deduplicates by dedupKey (returns existing, no new create)', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'existing', dedupKey: 'k:u1' });
    const res = await svc.create({ category: 'EXAM_ASSIGNED', title: 'x', userId: 'u1', dedupKey: 'k' });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(res[0].id).toBe('existing');
  });

  it('never throws into the caller even if the DB fails', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db down'));
    const res = await svc.create({ category: 'SYSTEM', title: 'x', userId: 'u1' });
    expect(res).toEqual([]); // swallowed, not thrown
  });

  it('fans out a role-based notification to each active user', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prisma.notification.create.mockImplementation(({ data }: any) => Promise.resolve({ id: data.userId, ...data }));
    const res = await svc.create({ category: 'ORPHAN_STUDY', title: 'x', roleKey: 'pacs_admin', organizationId: 'org1' });
    expect(res.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('recipient scope restricts list to own + role notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    const user: any = { id: 'u1', roles: ['radiologist'], organizationId: 'org1' };
    await svc.list(user, { page: 1, pageSize: 20 });
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR[0]).toEqual({ userId: 'u1' });
  });
});
