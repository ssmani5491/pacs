import { AlertsService } from './alerts.service';

function makePrisma() {
  return {
    systemAlert: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

describe('AlertsService', () => {
  let prisma: any; let svc: AlertsService;
  beforeEach(() => { prisma = makePrisma(); svc = new AlertsService(prisma, audit); jest.clearAllMocks(); });

  it('raises a new alert when none is open for the key', async () => {
    prisma.systemAlert.findFirst.mockResolvedValue(null);
    prisma.systemAlert.create.mockResolvedValue({ id: 'a1' });
    const a = await svc.raise({ alertKey: 'service:orthanc:down', level: 'CRITICAL', title: 'down' });
    expect(prisma.systemAlert.create).toHaveBeenCalled();
    expect(a!.id).toBe('a1');
  });

  it('dedups: bumps occurrences instead of creating a duplicate', async () => {
    prisma.systemAlert.findFirst.mockResolvedValue({ id: 'open1', detail: 'd' });
    prisma.systemAlert.update.mockResolvedValue({ id: 'open1', occurrences: 2 });
    await svc.raise({ alertKey: 'k', level: 'HIGH', title: 't' });
    expect(prisma.systemAlert.create).not.toHaveBeenCalled();
    expect(prisma.systemAlert.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'open1' } }));
  });

  it('acknowledge sets ACKNOWLEDGED + ackBy + audits', async () => {
    prisma.systemAlert.findUnique.mockResolvedValue({ id: 'a1', status: 'OPEN' });
    prisma.systemAlert.update.mockResolvedValue({ id: 'a1', status: 'ACKNOWLEDGED' });
    const user: any = { id: 'u1', isSuperAdmin: true };
    const r = await svc.acknowledge(user, 'a1');
    expect(r.status).toBe('ACKNOWLEDGED');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ALERT_ACKNOWLEDGE' }));
  });

  it('resolve sets RESOLVED + resolvedBy + audits', async () => {
    prisma.systemAlert.findUnique.mockResolvedValue({ id: 'a1', status: 'ACKNOWLEDGED' });
    prisma.systemAlert.update.mockResolvedValue({ id: 'a1', status: 'RESOLVED' });
    const user: any = { id: 'u1', isSuperAdmin: true };
    const r = await svc.resolve(user, 'a1');
    expect(r.status).toBe('RESOLVED');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ALERT_RESOLVE' }));
  });

  it('recover resolves an open alert as SYSTEM', async () => {
    prisma.systemAlert.findFirst.mockResolvedValue({ id: 'a1', status: 'OPEN' });
    prisma.systemAlert.update.mockResolvedValue({ id: 'a1', status: 'RESOLVED', resolvedBy: 'SYSTEM' });
    const r = await svc.recover('service:redis:down');
    expect(r!.resolvedBy).toBe('SYSTEM');
  });
});
