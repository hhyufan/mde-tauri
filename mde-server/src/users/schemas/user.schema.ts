import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * 本地登录与 OAuth 登录共用的用户持久化模型。
 */
@Schema({ timestamps: true })
export class User extends Document {
  // 规范化后的登录标识，写入前会统一转换为小写。
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  // 展示给客户端的公开用户名。
  @Prop({ required: true, trim: true })
  username: string;

  // 本地账号使用的密码散列；纯 OAuth 用户保持为 null。
  @Prop({ default: null })
  passwordHash: string;

  // 从身份提供方同步而来的可选头像地址。
  @Prop({ default: null })
  avatar: string;

  // OAuth 创建账号时记录的提供方标识，如 google 或 github。
  @Prop({ default: null })
  oauthProvider: string;

  // OAuth 提供方返回的稳定用户唯一标识。
  @Prop({ default: null })
  oauthId: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
