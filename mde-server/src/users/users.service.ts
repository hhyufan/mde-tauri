import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';

/**
 * 封装本地登录与 OAuth 登录共用的用户查询和创建流程。
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  // 复用已标准化的小写邮箱字段，保证登录查询不区分大小写。
  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  // 供 guard 和 controller 按 MongoDB 标识查询用户文档。
  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id);
  }

  // 创建本地账号用户，密码散列值由上游预先计算后传入。
  async create(data: { email: string; username: string; passwordHash: string }): Promise<User> {
    return this.userModel.create(data);
  }

  // 确保重复的 OAuth 登录始终落到同一个持久化用户账号上。
  async findOrCreateOAuth(data: {
    email: string;
    username: string;
    avatar?: string;
    oauthProvider: string;
    oauthId: string;
  }): Promise<User> {
    let user = await this.userModel.findOne({
      oauthProvider: data.oauthProvider,
      oauthId: data.oauthId,
    });
    if (!user) {
      user = await this.userModel.create({ ...data, passwordHash: null });
    }
    return user;
  }
}
