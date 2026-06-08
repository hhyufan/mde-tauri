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

/**
 * 云端同步接口。
 * 所有路由都要求用户先通过 JWT 鉴权。
 */
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  /** 返回当前用户的云端文件清单，不包含正文。 */
  @Get('manifest')
  getManifest(@Request() req) {
    return this.syncService.getManifest(req.user.userId);
  }

  /** 按游标时间增量拉取发生变化的文档元数据。 */
  @Get('changes')
  getChanges(@Request() req, @Query('since') since?: string) {
    return this.syncService.getChanges(req.user.userId, since);
  }

  /** 单文件写入接口，供新版按版本号同步的客户端优先使用。 */
  @Put('file/:fileId')
  pushFile(@Request() req, @Param('fileId') fileId: string, @Body() dto: PushFileDto) {
    return this.syncService.pushFile(req.user.userId, fileId, dto);
  }

  /** 拉取单个文件的完整内容。 */
  @Get('file/:fileId')
  pullFile(@Request() req, @Param('fileId') fileId: string) {
    return this.syncService.pullFile(req.user.userId, fileId);
  }

  /** 绑定设备与本地文件路径的映射关系。 */
  @Post('bindings/:fileId')
  bindPath(@Request() req, @Param('fileId') fileId: string, @Body() dto: BindPathDto) {
    return this.syncService.bindPath(req.user.userId, fileId, dto);
  }

  /** 以墓碑标记方式删除单个文件。 */
  @Delete('file/:fileId')
  deleteFile(@Request() req, @Param('fileId') fileId: string, @Body() dto: DeleteFileDto) {
    return this.syncService.deleteFile(req.user.userId, fileId, dto);
  }

  /** 清空当前用户的同步状态与协议兼容字段。 */
  @Post('reset')
  resetState(@Request() req) {
    return this.syncService.resetState(req.user.userId);
  }

  /** 兼容旧客户端的批量推送接口。 */
  @Post('push')
  push(@Request() req, @Body() dto: PushDto) {
    return this.syncService.pushDocuments(req.user.userId, dto.documents);
  }

  /** 兼容旧客户端的批量拉取接口。 */
  @Post('pull')
  pull(@Request() req, @Body() dto: PullDto) {
    return this.syncService.pullDocuments(req.user.userId, dto.fileIds);
  }

  /** 兼容旧客户端的批量删除接口。 */
  @Delete('documents')
  deleteDocuments(@Request() req, @Body() dto: PullDto) {
    return this.syncService.deleteDocuments(req.user.userId, dto.fileIds);
  }

  /** 读取用户编辑器同步配置。 */
  @Get('config')
  getConfig(@Request() req) {
    return this.syncService.getConfig(req.user.userId);
  }

  /** 更新用户编辑器同步配置。 */
  @Put('config')
  updateConfig(@Request() req, @Body() body: UpdateConfigDto) {
    return this.syncService.updateConfig(req.user.userId, body);
  }
}
