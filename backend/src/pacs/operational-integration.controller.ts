import { Controller, Get } from '@nestjs/common';
import { OperationalIntegrationService } from './operational-integration.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

/**
 * PACS Operations Module 5 — Operational Integration (read-only).
 * No @RequirePermissions at the route level: the Command Centre overview needs
 * ANY ONE of several view permissions (OR semantics), which the global
 * AND-combined PermissionsGuard can't express. The OR-gate + per-section
 * permission filtering is enforced in the service. The global JwtAuthGuard still
 * requires authentication on every route.
 */
@Controller('pacs/operations')
export class OperationalIntegrationController {
  constructor(private svc: OperationalIntegrationService) {}

  @Get('overview')
  overview(@CurrentUser() u: AuthUser) {
    return this.svc.overview(u);
  }

  @Get('exceptions')
  exceptions(@CurrentUser() u: AuthUser) {
    return this.svc.exceptions(u);
  }
}
