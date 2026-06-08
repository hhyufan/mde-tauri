import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncDocument, SyncDocumentSchema } from '../schemas/sync-document.schema';
import { SyncConfig, SyncConfigSchema } from '../schemas/sync-config.schema';

/**
 * 提供文档与配置同步所需的接口和持久化模型。
 */
@Module({
  imports: [
    // 在同一业务范围内同时注册同步文档和用户级同步元数据模型。
    MongooseModule.forFeature([
      { name: SyncDocument.name, schema: SyncDocumentSchema },
      { name: SyncConfig.name, schema: SyncConfigSchema },
    ]),
  ],
  providers: [SyncService],
  controllers: [SyncController],
})
export class SyncModule {}
