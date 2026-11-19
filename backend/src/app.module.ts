import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PermissionsGuard } from './rbac/permissions.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { OrgsModule } from './orgs/orgs.module';
import { DepartmentsModule } from './departments/departments.module';
import { DoctorsModule } from './doctors/doctors.module';
import { UsersModule } from './users/users.module';
import { ModalitiesModule } from './modalities/modalities.module';
import { AdminModule } from './admin/admin.module';
import { RolesModule } from './roles/roles.module';
import { PatientsModule } from './patients/patients.module';
import { OrdersModule } from './orders/orders.module';
import { WorklistModule } from './worklist/worklist.module';
import { OrthancModule } from './orthanc/orthanc.module';
import { IngestModule } from './ingest/ingest.module';
import { PacsModule } from './pacs/pacs.module';
import { DicomWebModule } from './dicomweb/dicomweb.module';
import { ReportsModule } from './reports/reports.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OpsModule } from './ops/ops.module';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    HealthModule,
    // Phase 2 — administrative modules
    OrgsModule,
    DepartmentsModule,
    DoctorsModule,
    UsersModule,
    ModalitiesModule,
    RolesModule,
    AdminModule,
    // Phase 3 — patients, orders, RIS worklist
    PatientsModule,
    OrdersModule,
    WorklistModule,
    // Phase 4 — Orthanc integration + DICOM ingest + PACS monitoring
    OrthancModule,
    IngestModule,
    PacsModule,
    // Phase 6 — authenticated DICOMweb proxy for the OHIF viewer
    DicomWebModule,
    // Phase 7 — radiology reporting engine (reports, templates, macros, PDF)
    ReportsModule,
    // Phase 8 — notifications, audit viewer, operational management
    NotificationsModule,
    OpsModule,
    // Product Validation Phase 1D — nightly automated backup
    BackupModule,
    // Phase 5+ modules: MWL, settings.
  ],
  providers: [
    // Guard order matters: JWT auth runs first (populates req.user), then RBAC.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
