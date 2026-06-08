import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';

/**
 * 用户领域模块，对外暴露可被其他功能复用的用户模型与服务。
 */
@Module({
  // 统一注册用户集合，供认证模块和其他业务模块注入使用。
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
