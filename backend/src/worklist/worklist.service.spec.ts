import { WorklistService } from './worklist.service';
import { WorklistQuery } from './dto';

const superUser: any = { id: 'u1', isSuperAdmin: true, organizationId: null };
const orgUser: any = { id: 'u2', isSuperAdmin: false, organizationId: 'ORG1' };

function makePrisma() {
  return {
    study: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
  } as any;
}
const audit = { log: jest.fn() } as any;

// Access the private buildWhere via query() and inspect the prisma call.
describe('WorklistService filters', () => {
  let prisma: any; let svc: WorklistService;
  beforeEach(() => { prisma = makePrisma(); svc = new WorklistService(prisma, audit); jest.clearAllMocks(); });

  async function whereFor(user: any, q: Partial<WorklistQuery>) {
    const query = Object.assign(new WorklistQuery(), q);
    await svc.query(user, query as WorklistQuery);
    return prisma.study.findMany.mock.calls[0][0].where;
  }

  it('applies organization scope for non-super users', async () => {
    const where = await whereFor(orgUser, {});
    expect(where).toMatchObject({ organizationId: 'ORG1' });
  });

  it('maps status tab to reportStatus', async () => {
    const where = await whereFor(superUser, { status: 'FINAL' });
    expect(where.reportStatus).toBe('FINAL');
  });

  it('PENDING maps to READY+DRAFT', async () => {
    const where = await whereFor(superUser, { status: 'PENDING' });
    expect(where.reportStatus).toEqual({ in: ['READY', 'DRAFT'] });
  });

  it('splits comma-separated modality filter', async () => {
    const where = await whereFor(superUser, { modality: 'CT,MR' });
    expect(where.modality).toEqual({ in: ['CT', 'MR'] });
  });

  it('myAssignment restricts to the current user', async () => {
    const where = await whereFor(orgUser, { myAssignment: 'true' });
    expect(where.assignedUserId).toBe('u2');
  });

  it('applies patient name filter via relation', async () => {
    const where = await whereFor(superUser, { patientName: 'Smith' });
    expect(where.patient).toEqual({ is: { name: { contains: 'Smith', mode: 'insensitive' } } });
  });

  it('builds a date range on studyDate', async () => {
    const where = await whereFor(superUser, { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(where.studyDate.gte).toBeInstanceOf(Date);
    expect(where.studyDate.lte).toBeInstanceOf(Date);
  });
});
