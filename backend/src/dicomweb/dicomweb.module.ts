import { Module } from '@nestjs/common';
import { DicomWebService } from './dicomweb.service';
import { DicomWebController } from './dicomweb.controller';

/**
 * Phase 6 — authenticated DICOMweb proxy for the OHIF viewer.
 * OrthancService/PrismaService/AuditService come from global modules.
 */
@Module({
  controllers: [DicomWebController],
  providers: [DicomWebService],
  exports: [DicomWebService],
})
export class DicomWebModule {}
