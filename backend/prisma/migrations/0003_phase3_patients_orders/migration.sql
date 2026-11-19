-- NOTE: the search_tsv column + GIN index from migration 0002 are intentionally
-- KEPT. Prisma's diff wants to drop them because they are maintained via raw SQL
-- (not in schema.prisma); those DROP statements were removed by hand.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "referringDoctorId" TEXT,
ADD COLUMN     "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "scheduled_orders" ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "clinicalHistory" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
ADD COLUMN     "studyDescription" TEXT,
ADD COLUMN     "studyId" TEXT;

-- (studies.search_tsv intentionally preserved — see note above)

-- CreateIndex
CREATE INDEX "patients_status_idx" ON "patients"("status");

-- CreateIndex
CREATE INDEX "patients_organizationId_registrationDate_idx" ON "patients"("organizationId", "registrationDate");

-- CreateIndex
CREATE INDEX "scheduled_orders_status_idx" ON "scheduled_orders"("status");

-- CreateIndex
CREATE INDEX "scheduled_orders_organizationId_scheduledAt_idx" ON "scheduled_orders"("organizationId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_referringDoctorId_fkey" FOREIGN KEY ("referringDoctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

