import { Controller, Get, Post, Patch, Param, Body, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import { PdfService } from './pdf.service';
import { CreateReportDto, UpdateReportDto, SignReportDto, AddendumDto } from './dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService, private pdf: PdfService) {}

  @Get('study/:studyId')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  forStudy(@CurrentUser() user: AuthUser, @Param('studyId') studyId: string) {
    return this.svc.getForStudy(user, studyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  versions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.versions(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.REPORT_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto, @Req() req: Request) {
    return this.svc.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.REPORT_EDIT)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateReportDto, @Req() req: Request) {
    return this.svc.update(user, id, dto, req.ip);
  }

  @Post(':id/preliminary')
  @RequirePermissions(PERMISSIONS.REPORT_PRELIMINARY)
  preliminary(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.submitPreliminary(user, id, req.ip);
  }

  @Post(':id/finalize')
  @RequirePermissions(PERMISSIONS.REPORT_FINALIZE)
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.finalize(user, id, req.ip);
  }

  @Post(':id/sign')
  @RequirePermissions(PERMISSIONS.REPORT_SIGN)
  sign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SignReportDto, @Req() req: Request) {
    return this.svc.sign(user, id, dto.password, req.ip);
  }

  @Post(':id/addendum')
  @RequirePermissions(PERMISSIONS.REPORT_AMEND)
  addendum(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddendumDto, @Req() req: Request) {
    return this.svc.createAddendum(user, id, dto, req.ip);
  }

  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.REPORT_DOWNLOAD)
  async pdfReport(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.pdf.generate(user, id, req.ip);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }
}
