import { IsEmail, IsString, MaxLength } from 'class-validator';

/** 登录请求体。 */
export class LoginDto {
  /** 用户登录邮箱。 */
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** 用户明文密码，由服务层负责比对散列值。 */
  @IsString()
  @MaxLength(128)
  password: string;
}
