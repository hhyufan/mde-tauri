import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';

/**
 * 根模块，负责组装配置、数据库连接和各个业务模块。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // 从环境变量读取连接配置，让本地与部署环境共用同一套启动路径。
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/mde'),
        // 针对短生命周期的 serverless 调用（如 Vercel Functions）做参数调优。
        // 保持较小连接池、尽快失败，并在热启动调用间复用已缓存连接。
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }),
    }),
    UsersModule,
    AuthModule,
    SyncModule,
  ],
})
export class AppModule {}
