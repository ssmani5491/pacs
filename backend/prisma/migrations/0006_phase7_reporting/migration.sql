-- AlterTable
ALTER TABLE "report_signatures" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'ELECTRONIC_APPROVAL',
ADD COLUMN     "reportVersion" INTEGER,
ADD COLUMN     "verification" TEXT;

-- AlterTable
ALTER TABLE "report_templates" ADD COLUMN     "bodyRecommendations" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "technique" TEXT;

-- AlterTable
ALTER TABLE "report_versions" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "comparison" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "parentReportId" TEXT,
ADD COLUMN     "preliminaryAt" TIMESTAMP(3),
ADD COLUMN     "reportType" TEXT NOT NULL DEFAULT 'MAIN',
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "report_macros" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "organizationId" TEXT,
    "departmentId" TEXT,
    "modalityType" TEXT,
    "findings" TEXT,
    "impression" TEXT,
    "recommendations" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_macros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_macros_ownerUserId_idx" ON "report_macros"("ownerUserId");

-- CreateIndex
CREATE INDEX "report_macros_organizationId_idx" ON "report_macros"("organizationId");

-- CreateIndex
CREATE INDEX "report_signatures_reportId_idx" ON "report_signatures"("reportId");

-- CreateIndex
CREATE INDEX "report_templates_organizationId_idx" ON "report_templates"("organizationId");

-- CreateIndex
CREATE INDEX "report_templates_modalityType_idx" ON "report_templates"("modalityType");

-- CreateIndex
CREATE INDEX "report_versions_reportId_idx" ON "report_versions"("reportId");

-- CreateIndex
CREATE INDEX "reports_organizationId_idx" ON "reports"("organizationId");

-- CreateIndex
CREATE INDEX "reports_parentReportId_idx" ON "reports"("parentReportId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_parentReportId_fkey" FOREIGN KEY ("parentReportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_macros" ADD CONSTRAINT "report_macros_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
