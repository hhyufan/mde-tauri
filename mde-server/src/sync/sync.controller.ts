import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BindPathDto,
  DeleteFileDto,
  PullDto,
  PushDto,
  PushFileDto,
  UpdateConfigDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Get('manifest')
  getManifest(@Request() req) {
    return this.syncService.getManifest(req.user.userId);
  }

  @Get('changes')
  getChanges(@Request() req, @Query('since') since?: string) {
    return this.syncService.getChanges(req.user.userId, since);
  }

  /** Per-file upsert. Preferred for versioned sync clients. */
  @Put('file/:fileId')
  pushFile(@Request() req, @Param('fileId') fileId: string, @Body() dto: PushFileDto) {
    return this.syncService.pushFile(req.user.userId, fileId, dto);
  }

  /** Per-file pull. */
  @Get('file/:fileId')
  pullFile(@Request() req, @Param('fileId') fileId: string) {
    return this.syncService.pullFile(req.user.userId, fileId);
  }

  @Post('bindings/:fileId')
  bindPath(@Request() req, @Param('fileId') fileId: string, @Body() dto: BindPathDto) {
    return this.syncService.bindPath(req.user.userId, fileId, dto);
  }

  /** Per-file delete (tombstone). */
  @Delete('file/:fileId')
  deleteFile(@Request() req, @Param('fileId') fileId: string, @Body() dto: DeleteFileDto) {
    return this.syncService.deleteFile(req.user.userId, fileId, dto);
  }

  @Post('reset')
  resetState(@Request() req) {
    return this.syncService.resetState(req.user.userId);
  }

  /** Legacy batch endpoints — kept for backward compat. */
  @Post('push')
  push(@Request() req, @Body() dto: PushDto) {
    return this.syncService.pushDocuments(req.user.userId, dto.documents);
  }

  @Post('pull')
  pull(@Request() req, @Body() dto: PullDto) {
    return this.syncService.pullDocuments(req.user.userId, dto.fileIds);
  }

  @Delete('documents')
  deleteDocuments(@Request() req, @Body() dto: PullDto) {
    return this.syncService.deleteDocuments(req.user.userId, dto.fileIds);
  }

  @Get('config')
  getConfig(@Request() req) {
    return this.syncService.getConfig(req.user.userId);
  }

  @Put('config')
  updateConfig(@Request() req, @Body() body: UpdateConfigDto) {
    return this.syncService.updateConfig(req.user.userId, body);
  }
}
