-- NOTE: Prisma's diff again wants to DROP studies.search_tsv + its GIN index
-- (raw-SQL FTS from migration 0002, not modeled in schema.prisma). Those two
-- destructive statements were removed by hand. The index is intentionally KEPT.

-- AlterTable
ALTER TABLE "modality_devices" ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "studies" ADD COLUMN     "isReconciled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "studyTime" TEXT;

-- CreateTable
CREATE TABLE "dicom_reception_logs" (
    "id" TEXT NOT NULL,
    "orthancStudyId" TEXT,
    "studyInstanceUid" TEXT,
    "accessionNumber" TEXT,
    "callingAet" TEXT,
    "modality" TEXT,
    "modalityDeviceId" TEXT,
    "status" TEXT NOT NULL,
    "seriesCount" INTEGER NOT NULL DEFAULT 0,
    "instanceCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_reception_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dicom_reception_logs_status_idx" ON "dicom_reception_logs"("status");

-- CreateIndex
CREATE INDEX "dicom_reception_logs_studyInstanceUid_idx" ON "dicom_reception_logs"("studyInstanceUid");

-- CreateIndex
CREATE INDEX "dicom_reception_logs_createdAt_idx" ON "dicom_reception_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "dicom_reception_logs" ADD CONSTRAINT "dicom_reception_logs_modalityDeviceId_fkey" FOREIGN KEY ("modalityDeviceId") REFERENCES "modality_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

