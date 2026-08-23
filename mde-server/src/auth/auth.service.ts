import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { createHash, randomBytes } from 'crypto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 认证核心服务。
 * 负责账户校验、密码散列、令牌签发与刷新。
 */
@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /** 校验邮箱和密码，成功时返回用户实体，失败时返回 null。 */
  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  /** 创建新用户并立即返回登录态。 */
  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    // 密码仅以散列形式持久化，避免明文落库。
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      email: dto.email.toLowerCase(),
      username: dto.username,
      passwordHash,
    });
    return this.buildTokenResponse(user);
  }

  /** 登录并签发新的访问令牌。 */
  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return this.buildTokenResponse(user);
  }

  /** 刷新现有用户的访问令牌。 */
  async refreshToken(refreshToken: string) {
    const oldHash = this.hashRefreshToken(refreshToken);
    const user = await this.usersService.findByRefreshTokenHash(oldHash);
    const record = user?.refreshTokens?.find((item) => item.tokenHash === oldHash);
    if (!user || !record || new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const nextToken = this.createRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const rotated = await this.usersService.rotateRefreshToken(
      user._id.toString(),
      oldHash,
      this.hashRefreshToken(nextToken),
      expiresAt,
    );
    if (!rotated) throw new UnauthorizedException('Refresh token was already used');
    return this.buildAccessResponse(user, nextToken);
  }

  async logout(refreshToken: string) {
    if (refreshToken) await this.usersService.revokeRefreshToken(this.hashRefreshToken(refreshToken));
    return { revoked: true };
  }

  /** 统一组装鉴权接口返回结构。 */
  private async buildTokenResponse(user: any) {
    const refreshToken = this.createRefreshToken();
    await this.usersService.addRefreshToken(
      user._id.toString(),
      this.hashRefreshToken(refreshToken),
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );
    return this.buildAccessResponse(user, refreshToken);
  }

  private buildAccessResponse(user: any, refreshToken: string) {
    const payload = { sub: user._id.toString(), email: user.email };
    return {
      access_token: this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS }),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        avatar: user.avatar,
      },
    };
  }

  private createRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
  }
}
