-- CreateTable
CREATE TABLE "pacs_destinations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "aeTitle" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "callingAet" TEXT NOT NULL DEFAULT 'GGHPACS',
    "connectionTimeout" INTEGER NOT NULL DEFAULT 10,
    "associationTimeout" INTEGER NOT NULL DEFAULT 30,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacs_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dicom_transfer_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "destinationId" TEXT NOT NULL,
    "studyId" TEXT,
    "studyInstanceUid" TEXT NOT NULL,
    "orthancStudyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalInstances" INTEGER NOT NULL DEFAULT 0,
    "successInstances" INTEGER NOT NULL DEFAULT 0,
    "failedInstances" INTEGER NOT NULL DEFAULT 0,
    "pendingInstances" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "orthancJobId" TEXT,
    "transferSpeedKbps" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "dedupKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dicom_transfer_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dicom_transfer_instances" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sopInstanceUid" TEXT NOT NULL,
    "orthancInstanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "dicom_transfer_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pacs_destinations_organizationId_idx" ON "pacs_destinations"("organizationId");

-- CreateIndex
CREATE INDEX "pacs_destinations_aeTitle_idx" ON "pacs_destinations"("aeTitle");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_transfer_jobs_dedupKey_key" ON "dicom_transfer_jobs"("dedupKey");

-- CreateIndex
CREATE INDEX "dicom_transfer_jobs_organizationId_createdAt_idx" ON "dicom_transfer_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "dicom_transfer_jobs_status_idx" ON "dicom_transfer_jobs"("status");

-- CreateIndex
CREATE INDEX "dicom_transfer_jobs_destinationId_idx" ON "dicom_transfer_jobs"("destinationId");

-- CreateIndex
CREATE INDEX "dicom_transfer_jobs_studyInstanceUid_idx" ON "dicom_transfer_jobs"("studyInstanceUid");

-- CreateIndex
CREATE INDEX "dicom_transfer_instances_jobId_idx" ON "dicom_transfer_instances"("jobId");

-- CreateIndex
CREATE INDEX "dicom_transfer_instances_status_idx" ON "dicom_transfer_instances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_transfer_instances_jobId_sopInstanceUid_key" ON "dicom_transfer_instances"("jobId", "sopInstanceUid");

-- AddForeignKey
ALTER TABLE "pacs_destinations" ADD CONSTRAINT "pacs_destinations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dicom_transfer_jobs" ADD CONSTRAINT "dicom_transfer_jobs_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "pacs_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dicom_transfer_instances" ADD CONSTRAINT "dicom_transfer_instances_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "dicom_transfer_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

