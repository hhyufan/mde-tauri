import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncDocument, SyncDocumentSchema } from '../schemas/sync-document.schema';
import { SyncConfig, SyncConfigSchema } from '../schemas/sync-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SyncDocument.name, schema: SyncDocumentSchema },
      { name: SyncConfig.name, schema: SyncConfigSchema },
    ]),
  ],
  providers: [SyncService],
  controllers: [SyncController],
})
export class SyncModule {}
