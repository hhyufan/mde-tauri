import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';

/**
 * 认证相关接口。
 * 负责用户注册、登录、资料读取与令牌刷新。
 */
class RefreshTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** 注册新用户并返回初始访问令牌。 */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** 使用邮箱和密码登录。 */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  /** 使用一次性旋转 refresh token 签发下一组令牌。 */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('logout')
  async logout(@Body() body: RefreshTokenDto) {
    return this.authService.logout(body.refreshToken);
  }
}
