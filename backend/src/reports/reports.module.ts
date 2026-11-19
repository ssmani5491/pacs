import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PdfService } from './pdf.service';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { MacrosService } from './macros.service';
import { MacrosController } from './macros.controller';
import { ReportingWorklistService } from './reporting-worklist.service';
import { ReportingWorklistController } from './reporting-worklist.controller';

/**
 * Phase 7 — radiology reporting engine.
 * AuthModule gives us AuthService (step-up re-auth for signing).
 * Prisma/Audit come from global modules.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    ReportsController,
    TemplatesController,
    MacrosController,
    ReportingWorklistController,
  ],
  providers: [
    ReportsService,
    PdfService,
    TemplatesService,
    MacrosService,
    ReportingWorklistService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
