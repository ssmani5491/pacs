-- CreateTable
CREATE TABLE "mwl_query_logs" (
    "id" TEXT NOT NULL,
    "callingAet" TEXT,
    "calledAet" TEXT,
    "remoteHost" TEXT,
    "status" TEXT NOT NULL,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mwl_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mwl_query_logs_status_idx" ON "mwl_query_logs"("status");

-- CreateIndex
CREATE INDEX "mwl_query_logs_createdAt_idx" ON "mwl_query_logs"("createdAt");

-- CreateIndex
CREATE INDEX "mwl_query_logs_callingAet_idx" ON "mwl_query_logs"("callingAet");

