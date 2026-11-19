import { Global, Module } from '@nestjs/common';
import { HealthService } from './health.service';
import { MetricsService } from './metrics.service';
import { AlertsService } from './alerts.service';
import { SupervisorService } from './supervisor.service';
import { OpsController } from './ops.controller';
import { OpsScheduler } from './ops.scheduler';

/**
 * Phase 8 — operational management: health checks, dashboard metrics, system
 * alerts, and the in-process background scheduler. AlertsService is exported so
 * event-driven code (DICOM/MWL) can raise alerts too.
 */
@Global()
@Module({
  controllers: [OpsController],
  providers: [HealthService, MetricsService, AlertsService, OpsScheduler, SupervisorService],
  exports: [HealthService, MetricsService, AlertsService],
})
export class OpsModule {}
