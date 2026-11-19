import { Module } from '@nestjs/common';
import { PacsController } from './pacs.controller';
import { PacsService } from './pacs.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ReversePushController } from './reverse-push.controller';
import { ReversePushService } from './reverse-push.service';
import { ReversePushScheduler } from './reverse-push.scheduler';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';
import { ArchiveScheduler } from './archive.scheduler';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { StorageScheduler } from './storage.scheduler';
import { OperationsHistoryController } from './operations-history.controller';
import { OperationsHistoryService } from './operations-history.service';
import { OperationalIntegrationController } from './operational-integration.controller';
import { OperationalIntegrationService } from './operational-integration.service';

// PACS Operations Modules 1 (reverse push) + 2 (archive) + 3 (storage) +
// 4 (transfer & archive history, read-only) are registered here alongside the
// existing PACS monitoring/reconciliation.
@Module({
  controllers: [PacsController, ReversePushController, ArchiveController, StorageController, OperationsHistoryController, OperationalIntegrationController],
  providers: [PacsService, ReconciliationService, ReversePushService, ReversePushScheduler, ArchiveService, ArchiveScheduler, StorageService, StorageScheduler, OperationsHistoryService, OperationalIntegrationService],
  exports: [ReversePushService, ArchiveService, StorageService],
})
export class PacsModule {}
