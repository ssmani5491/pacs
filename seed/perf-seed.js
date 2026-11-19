// Phase 3 performance seed — SYNTHETIC data only.
// 1,000 patients + 5,000 orders + 5,000 studies (with series) under GG Hospital.
// Idempotent-ish: tags all records so they can be identified/removed.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

const FIRST = ['Arun','Divya','Mohammed','Sita','Rahul','Fathima','Joseph','Lakshmi','Thomas','Ayesha','Vijay','Nithya','Suresh','Anita','Ramesh','Priya','Karthik','Meera','Abdul','Reena'];
const LAST = ['Nair','Kumar','Menon','Pillai','Khan','Thomas','Varghese','Reddy','Sharma','Das','Iyer','Joseph','Rao','Mathew','Anand'];
const MODS = ['CT','MR','CR','DX','US','MG','NM','PT','XA'];
const DESCS = ['CHEST','HRCT THORAX','CT ABDOMEN','BRAIN MRI','KNEE XRAY','MAMMOGRAM','USG ABDOMEN','CT UROGRAM','PET CT','ANGIOGRAM'];
const STATUSES = ['READY','DRAFT','PRELIMINARY','FINAL','CANCELLED'];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const uid = () => `1.2.826.${Date.now()}.${Math.floor(Math.random()*1e9)}.${Math.floor(Math.random()*1e6)}`;

async function main() {
  const org = await p.organization.findUnique({ where: { code: 'GGH' } });
  if (!org) throw new Error('GG Hospital org not found — run base seed first');
  const orgId = org.id;

  console.time('patients');
  const patientIds = [];
  const baseCount = await p.patient.count({ where: { organizationId: orgId } });
  for (let i = 0; i < 1000; i++) {
    const seq = baseCount + i + 1;
    const dobYear = 1940 + Math.floor(Math.random() * 80);
    const patient = await p.patient.create({
      data: {
        mrn: `PERF${String(seq).padStart(8, '0')}`,
        name: `${rand(FIRST)} ${rand(LAST)}`,
        dob: new Date(dobYear, Math.floor(Math.random()*12), 1 + Math.floor(Math.random()*28)),
        gender: rand(['M','F']),
        mobile: `9${Math.floor(100000000 + Math.random()*899999999)}`,
        organizationId: orgId,
        status: 'ACTIVE',
      },
    });
    patientIds.push(patient.id);
    if (i % 200 === 0) process.stdout.write(`  patients ${i}\r`);
  }
  console.log(`\n  created ${patientIds.length} patients`);
  console.timeEnd('patients');

  console.time('orders+studies');
  for (let i = 0; i < 5000; i++) {
    const pid = rand(patientIds);
    const mod = rand(MODS);
    const desc = rand(DESCS);
    const when = new Date(Date.now() - Math.floor(Math.random() * 365) * 86400000);
    const acc = `PERF${String(i + 1).padStart(8, '0')}`;

    await p.scheduledOrder.create({
      data: {
        patientId: pid, organizationId: orgId, accessionNumber: acc,
        modalityType: mod, procedureDesc: desc, studyDescription: desc,
        priority: rand(['ROUTINE','ROUTINE','ROUTINE','URGENT','STAT']),
        scheduledAt: when, status: 'COMPLETED',
      },
    });

    const studyUid = uid();
    const study = await p.study.create({
      data: {
        organizationId: orgId, patientId: pid, studyInstanceUid: studyUid,
        accessionNumber: acc, studyDate: when, description: desc, modality: mod,
        reportStatus: rand(STATUSES), imageCount: 1 + Math.floor(Math.random() * 500),
        searchText: `${desc} ${acc}`,
      },
    });
    // one series each (lightweight)
    await p.series.create({
      data: { studyId: study.id, seriesInstanceUid: uid(), seriesNumber: 1, modality: mod, description: desc, instanceCount: study.imageCount },
    });
    if (i % 250 === 0) process.stdout.write(`  studies ${i}\r`);
  }
  console.log('\n  created 5000 orders + 5000 studies');
  console.timeEnd('orders+studies');

  const totals = await p.$transaction([
    p.patient.count({ where: { organizationId: orgId } }),
    p.scheduledOrder.count({ where: { organizationId: orgId } }),
    p.study.count({ where: { organizationId: orgId } }),
  ]);
  console.log(`TOTALS — patients:${totals[0]} orders:${totals[1]} studies:${totals[2]}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
