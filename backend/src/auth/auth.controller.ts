import { Body, Controller, Post, Get, Req, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, ChangePasswordDto } from './dto';
import { CurrentUser, AuthUser } from './current-user.decorator';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Current identity + effective permissions, for UI gating.
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id, username: user.username, roles: user.roles,
      isSuperAdmin: user.isSuperAdmin, permissions: user.permissions,
      organizationId: user.organizationId, departmentId: user.departmentId,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.username, dto.password, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('id') userId: string) {
    return this.auth.logout(userId);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
  }
}
