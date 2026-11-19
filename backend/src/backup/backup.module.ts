import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupScheduler } from './backup.scheduler';

// Nightly backup automation (Product Validation Phase 1D). AlertsService
// comes from the @Global() OpsModule; no need to re-provide it here.
@Module({
  controllers: [BackupController],
  providers: [BackupService, BackupScheduler],
})
export class BackupModule {}
