-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "link" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "patientId" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "reportId" TEXT,
ADD COLUMN     "roleKey" TEXT,
ADD COLUMN     "studyId" TEXT,
ALTER COLUMN "type" DROP NOT NULL;

-- CreateTable
CREATE TABLE "notification_delivery_attempts" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "alertKey" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'WARNING',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_health_checks" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseMs" INTEGER,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_job_records" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupKey" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_job_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_notificationId_idx" ON "notification_delivery_attempts"("notificationId");

-- CreateIndex
CREATE INDEX "notification_delivery_attempts_status_idx" ON "notification_delivery_attempts"("status");

-- CreateIndex
CREATE INDEX "system_alerts_alertKey_idx" ON "system_alerts"("alertKey");

-- CreateIndex
CREATE INDEX "system_alerts_status_idx" ON "system_alerts"("status");

-- CreateIndex
CREATE INDEX "system_alerts_level_idx" ON "system_alerts"("level");

-- CreateIndex
CREATE INDEX "system_alerts_organizationId_idx" ON "system_alerts"("organizationId");

-- CreateIndex
CREATE INDEX "service_health_checks_service_checkedAt_idx" ON "service_health_checks"("service", "checkedAt");

-- CreateIndex
CREATE INDEX "service_health_checks_checkedAt_idx" ON "service_health_checks"("checkedAt");

-- CreateIndex
CREATE INDEX "background_job_records_jobType_createdAt_idx" ON "background_job_records"("jobType", "createdAt");

-- CreateIndex
CREATE INDEX "background_job_records_status_idx" ON "background_job_records"("status");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");

-- CreateIndex
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "notifications"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_roleKey_idx" ON "notifications"("roleKey");

-- CreateIndex
CREATE INDEX "notifications_category_idx" ON "notifications"("category");

-- CreateIndex
CREATE INDEX "notifications_priority_idx" ON "notifications"("priority");

-- CreateIndex
CREATE INDEX "notifications_archived_idx" ON "notifications"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupKey_key" ON "notifications"("dedupKey");

-- AddForeignKey
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 8 backfill: populate audit_logs.organizationId + username from the user
-- join for existing rows (additive data fix; append-only rows are not otherwise
-- altered). System/anonymous rows (null userId) stay org-null.
UPDATE "audit_logs" a
SET "organizationId" = u."organizationId",
    "username" = u."username"
FROM "users" u
WHERE a."userId" = u."id"
  AND (a."organizationId" IS NULL OR a."username" IS NULL);
