import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 基于 JWT Bearer Token 的路由守卫。 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
