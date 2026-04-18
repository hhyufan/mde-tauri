import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PullDto, PushDto, PushFileDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Get('manifest')
  getManifest(@Request() req) {
    return this.syncService.getManifest(req.user.userId);
  }

  /** Per-file upsert. Recommended for new clients. */
  @Post('file')
  pushFile(@Request() req, @Body() dto: PushFileDto) {
    return this.syncService.pushFile(req.user.userId, dto);
  }

  /** Per-file pull. */
  @Get('file/:fileId')
  pullFile(@Request() req, @Param('fileId') fileId: string) {
    return this.syncService.pullFile(req.user.userId, fileId);
  }

  /** Per-file delete (soft). */
  @Delete('file/:fileId')
  deleteFile(@Request() req, @Param('fileId') fileId: string) {
    return this.syncService.deleteFile(req.user.userId, fileId);
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
  updateConfig(@Request() req, @Body() body: Record<string, any>) {
    return this.syncService.updateConfig(req.user.userId, body);
  }
}
