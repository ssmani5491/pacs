import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

// Read-only list of roles for the User management role picker.
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RolesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.role.findMany({ select: { key: true, name: true }, orderBy: { name: 'asc' } });
  }
}
