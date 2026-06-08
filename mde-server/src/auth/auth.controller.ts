import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * 认证相关接口。
 * 负责用户注册、登录、资料读取与令牌刷新。
 */
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** 注册新用户并返回初始访问令牌。 */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** 使用邮箱和密码登录。 */
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /** 返回当前令牌对应的用户信息。 */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  /** 基于当前已认证用户重新签发访问令牌。 */
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Request() req) {
    return this.authService.refreshToken(req.user.userId);
  }
}
