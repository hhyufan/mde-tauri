import { IsEmail, IsString, MinLength } from 'class-validator';

/** 注册请求体。 */
export class RegisterDto {
  /** 注册邮箱，同时也是后续登录账号。 */
  @IsEmail()
  email: string;

  /** 展示用用户名。 */
  @IsString()
  @MinLength(2)
  username: string;

  /** 原始密码，服务层会在入库前完成散列。 */
  @IsString()
  @MinLength(6)
  password: string;
}
