-- CreateTable
CREATE TABLE "archive_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "studyId" TEXT,
    "studyInstanceUid" TEXT NOT NULL,
    "orthancStudyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "compressionLevel" INTEGER NOT NULL DEFAULT 6,
    "workerCount" INTEGER NOT NULL DEFAULT 2,
    "originalBytes" BIGINT,
    "compressedBytes" BIGINT,
    "compressionRatio" DOUBLE PRECISION,
    "savingsPercent" DOUBLE PRECISION,
    "instanceCount" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "archivePath" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyDetail" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "dedupKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archive_jobs_dedupKey_key" ON "archive_jobs"("dedupKey");

-- CreateIndex
CREATE INDEX "archive_jobs_organizationId_createdAt_idx" ON "archive_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "archive_jobs_status_idx" ON "archive_jobs"("status");

-- CreateIndex
CREATE INDEX "archive_jobs_studyInstanceUid_idx" ON "archive_jobs"("studyInstanceUid");

