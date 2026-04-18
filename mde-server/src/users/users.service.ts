import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id);
  }

  async create(data: { email: string; username: string; passwordHash: string }): Promise<User> {
    return this.userModel.create(data);
  }

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
