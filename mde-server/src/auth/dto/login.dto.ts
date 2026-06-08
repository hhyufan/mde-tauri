import { IsEmail, IsString } from 'class-validator';

/** 登录请求体。 */
export class LoginDto {
  /** 用户登录邮箱。 */
  @IsEmail()
  email: string;

  /** 用户明文密码，由服务层负责比对散列值。 */
  @IsString()
  password: string;
}
