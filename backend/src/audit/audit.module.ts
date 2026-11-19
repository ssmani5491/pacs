import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditViewerService } from './audit-viewer.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditViewerService],
  exports: [AuditService],
})
export class AuditModule {}
