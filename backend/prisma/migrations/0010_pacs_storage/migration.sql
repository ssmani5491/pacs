-- CreateTable
CREATE TABLE "storage_snapshots" (
    "id" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orthancBytes" BIGINT NOT NULL DEFAULT 0,
    "patients" INTEGER NOT NULL DEFAULT 0,
    "studies" INTEGER NOT NULL DEFAULT 0,
    "series" INTEGER NOT NULL DEFAULT 0,
    "instances" INTEGER NOT NULL DEFAULT 0,
    "archiveBytes" BIGINT NOT NULL DEFAULT 0,
    "diskTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "diskUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "diskAvailBytes" BIGINT NOT NULL DEFAULT 0,
    "modalityBreakdown" JSONB,

    CONSTRAINT "storage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_snapshots_capturedAt_idx" ON "storage_snapshots"("capturedAt");

