-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "filePath" TEXT,
    "bytes" BIGINT,
    "sha256" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyDetail" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_runId_idx" ON "backup_runs"("runId");

-- CreateIndex
CREATE INDEX "backup_runs_component_createdAt_idx" ON "backup_runs"("component", "createdAt");

-- CreateIndex
CREATE INDEX "backup_runs_status_idx" ON "backup_runs"("status");
