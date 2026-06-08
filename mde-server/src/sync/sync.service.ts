import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SyncDocument } from '../schemas/sync-document.schema';
import { SyncConfig } from '../schemas/sync-config.schema';
import {
  BindPathDto,
  DeleteFileDto,
  PushFileDto,
  UpdateConfigDto,
} from './dto/push.dto';

/**
 * 旧版 schema 遗留的索引名称，必须在当前 `(userId, fileId)` 模型写入前删除。
 * 其中历史唯一索引 `userId_1_relativePath_1` 会把所有新文档
 * （它们已不再包含 `relativePath` 字段，因此会被序列化为 `null`）
 * 视为重复记录，导致从第二次插入开始就触发 E11000。
 */
const LEGACY_DOC_INDEXES = ['userId_1_relativePath_1'];

/**
 * 同步核心服务。
 * 负责文档清单、增量同步、单文件冲突控制以及用户同步配置读写。
 */
@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectModel(SyncDocument.name) private docModel: Model<SyncDocument>,
    @InjectModel(SyncConfig.name) private configModel: Model<SyncConfig>,
  ) {}

  /**
   * 启动时执行一次自修复：
   * 1. 删除旧版 schema 留下的索引。
   * 2. 硬删除 `fileId` 为空或为 null 的文档，这些文档来自旧的
   *    `relativePath` 键模型，无法再通过 fileId 访问，只会污染 manifest 返回结果。
   */
  async onModuleInit() {
    // ── 1. 清理旧索引 ───────────────────────────────────────────────────
    try {
      const existing = await this.docModel.collection.indexes();
      const existingNames = new Set(existing.map((i) => i.name));
      for (const name of LEGACY_DOC_INDEXES) {
        if (!existingNames.has(name)) continue;
        try {
          await this.docModel.collection.dropIndex(name);
          this.logger.warn(`Dropped legacy index ${name} on syncdocuments`);
        } catch (err) {
          this.logger.error(
            `Failed to drop legacy index ${name}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not introspect syncdocuments indexes: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // ── 2. 清理没有 fileId 的孤儿文档 ────────────────────────────────────
    // 旧 schema 以 `relativePath` 作为主键保存文档，这些记录从未拿到 `fileId`，
    // 因此对应字段会是 null / undefined / 空字符串。
    // 由于客户端现在只能通过 fileId 操作文档，它们会在每次 manifest 响应中
    // 像无法删除的“幽灵记录”一样反复出现。
    try {
      const result = await this.docModel.deleteMany({
        $or: [{ fileId: null }, { fileId: '' }, { fileId: { $exists: false } }],
      });
      if (result.deletedCount > 0) {
        this.logger.warn(
          `Purged ${result.deletedCount} orphan syncdocument(s) with no fileId`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not purge orphan syncdocuments: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** 将字符串形式的用户 ID 转成 Mongo ObjectId。 */
  private userObjectId(userId: string): Types.ObjectId {
    return new Types.ObjectId(userId);
  }

  /** Mongo 键名不能包含 `.` 和 `$`，设备 ID 入库前需做最小清洗。 */
  private sanitizeDeviceId(deviceId?: string): string {
    return deviceId ? deviceId.replace(/[.$]/g, '_') : '';
  }

  /** 提取允许持久化和返回给客户端的同步配置字段。 */
  private pickConfigFields(config: Record<string, any>): Record<string, any> {
    return {
      theme: config.theme ?? 'light',
      language: config.language ?? 'en',
      fontSize: config.fontSize ?? 14,
      fontFamily: config.fontFamily ?? 'JetBrains Mono',
      lineHeight: config.lineHeight ?? 24,
      tabSize: config.tabSize ?? 2,
      wordWrap: config.wordWrap ?? true,
      lineNumbers: config.lineNumbers ?? true,
      minimap: config.minimap ?? { enabled: false },
      autoSave: config.autoSave ?? true,
      workspacePath: config.workspacePath ?? '',
      editorState: config.editorState ?? {},
      protocolVersion:
        typeof config.protocolVersion === 'number' ? config.protocolVersion : 1,
      updatedAt:
        typeof config.updatedAt === 'number'
          ? config.updatedAt
          // 历史数据中配置更新时间存放在 `updatedAtMs` 字段中。
          : typeof config.updatedAtMs === 'number'
            ? config.updatedAtMs
            : 0,
    };
  }

  /** 序列化文档，按需决定是否带上正文内容。 */
  private serializeDoc(
    doc: Partial<SyncDocument> & {
      fileId?: string;
      fileName?: string;
      originalPath?: string;
      source?: string;
      content?: string;
      compressed?: boolean;
      size?: number;
      encoding?: string;
      lineEnding?: string;
      checksum?: string;
      contentHash?: string;
      rev?: number;
      deleted?: boolean;
      deviceBindings?: Record<string, string>;
      updatedAt?: Date;
    },
    includeContent = false,
  ) {
    return {
      fileId: doc.fileId || '',
      fileName: doc.fileName || '',
      originalPath: doc.originalPath || '',
      source: doc.source || 'manual',
      compressed: doc.compressed ?? false,
      size: doc.size ?? 0,
      encoding: doc.encoding || 'UTF-8',
      lineEnding: doc.lineEnding || 'LF',
      checksum: doc.checksum || '',
      contentHash: doc.contentHash || doc.checksum || '',
      rev: doc.rev ?? 0,
      deleted: doc.deleted ?? false,
      deviceBindings: doc.deviceBindings || {},
      updatedAt: doc.updatedAt,
      ...(includeContent ? { content: doc.content || '' } : {}),
    };
  }

  /** 统一抛出修订号冲突错误，并附带当前服务端版本。 */
  private throwRevisionConflict(current: any): never {
    throw new ConflictException({
      code: 'revision_conflict',
      current: current ? this.serializeDoc(current, true) : null,
    });
  }

  /**
   * 返回用户云端全部未删除文档的纯元数据 manifest，
   * 供客户端判断哪些内容需要推送或拉取。
   */
  async getManifest(userId: string) {
    const docs = await this.docModel
      .find({
        userId: this.userObjectId(userId),
        fileId: { $exists: true, $nin: [null, ''] },
        deleted: false,
      })
      .sort({ updatedAt: 1 })
      .lean<any[]>();
    return docs.map((doc) => this.serializeDoc(doc));
  }

  /** 根据时间游标返回用户文档的增量变化列表。 */
  async getChanges(userId: string, since?: string) {
    const sinceDate = since ? new Date(since) : null;
    const filter: Record<string, any> = {
      userId: this.userObjectId(userId),
      fileId: { $exists: true, $nin: [null, ''] },
    };
    if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
      filter.updatedAt = { $gt: sinceDate };
    }
    const docs = await this.docModel
      .find(filter)
      .sort({ updatedAt: 1 })
      .lean<any[]>();
    return {
      changes: docs.map((doc) => this.serializeDoc(doc)),
      cursor:
        docs.length > 0
          ? new Date(docs[docs.length - 1].updatedAt).toISOString()
          : since || '',
    };
  }

  /**
   * 写入单个文件。
   * 通过 `baseRev` 和 `mutationId` 同时处理并发冲突与客户端重试去重。
   */
  async pushFile(userId: string, fileId: string, doc: PushFileDto) {
    const userObjectId = this.userObjectId(userId);
    const safeDeviceId = this.sanitizeDeviceId(doc.deviceId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId })
      .lean<any>();

    // 相同 mutation 代表客户端在重试同一次写入，直接返回现状即可。
    if (existing?.lastMutationId && existing.lastMutationId === doc.mutationId) {
      return this.serializeDoc(existing);
    }

    const payload: Record<string, any> = {
      fileId,
      fileName: doc.fileName ?? '',
      originalPath: doc.originalPath ?? '',
      source: doc.source ?? 'manual',
      content: doc.content,
      compressed: doc.compressed ?? false,
      size: doc.size ?? 0,
      encoding: doc.encoding ?? 'UTF-8',
      lineEnding: doc.lineEnding ?? 'LF',
      checksum: doc.checksum,
      contentHash: doc.checksum,
      deleted: false,
      deletedAt: null,
      lastMutationId: doc.mutationId,
    };
    if (safeDeviceId) {
      payload[`deviceBindings.${safeDeviceId}`] = doc.devicePath ?? '';
    }

    try {
      if (!existing) {
        // 新文件只能基于 rev=0 创建，避免把已有文件误当成首次上传。
        if ((doc.baseRev ?? 0) !== 0) {
          this.throwRevisionConflict(null);
        }
        const created = await this.docModel.create({
          userId: userObjectId,
          ...payload,
          rev: 1,
          deviceBindings: safeDeviceId ? { [safeDeviceId]: doc.devicePath ?? '' } : {},
        });
        return this.serializeDoc(created.toObject());
      }

      // 版本不一致时提示客户端先拉取最新内容再合并。
      if ((doc.baseRev ?? 0) !== existing.rev) {
        this.throwRevisionConflict(existing);
      }

      const updated = await this.docModel.findOneAndUpdate(
        {
          userId: userObjectId,
          fileId,
          rev: existing.rev,
        },
        {
          $set: payload,
          $inc: { rev: 1 },
        },
        { new: true },
      ).lean<any>();

      if (!updated) {
        const current = await this.docModel
          .findOne({ userId: userObjectId, fileId })
          .lean<any>();
        this.throwRevisionConflict(current);
      }
      return this.serializeDoc(updated);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error(
        `[pushFile] userId=${userId} fileId=${fileId} ` +
          `fileName=${doc.fileName ?? ''} compressed=${doc.compressed} ` +
          `size=${doc.size} contentLen=${doc.content?.length ?? 0} ` +
          `deviceId=${doc.deviceId ?? ''} devicePath=${doc.devicePath ?? ''}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        `pushFile failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 兼容旧调用方的批量推送接口，适用于一次仍只发送少量小文件的场景。
   * 新客户端应改为逐文件调用 `pushFile()`。
   */
  async pushDocuments(userId: string, documents: PushFileDto[]) {
    let pushed = 0;
    for (const doc of documents) {
      if (!doc.fileId) continue;
      await this.pushFile(userId, doc.fileId, doc);
      pushed += 1;
    }
    return { pushed };
  }

  /**
   * 拉取单个文档的完整正文。
   * 按文件拆分拉取可将响应体积稳定控制在 Vercel 的限制之内。
   */
  async pullFile(userId: string, fileId: string) {
    const doc = await this.docModel
      .findOne({
        userId: this.userObjectId(userId),
        fileId,
        deleted: false,
      })
      .lean<any>();
    if (!doc) return null;
    return this.serializeDoc(doc, true);
  }

  /** 兼容旧客户端的多文件拉取接口，按 `fileIds` 查询。 */
  async pullDocuments(userId: string, fileIds: string[]) {
    const docs = await this.docModel
      .find({
        userId: this.userObjectId(userId),
        fileId: { $in: fileIds },
        deleted: false,
      })
      .lean<any[]>();
    return docs.map((doc) => this.serializeDoc(doc, true));
  }

  /** 为指定设备记录文件在本机上的保存路径。 */
  async bindPath(userId: string, fileId: string, dto: BindPathDto) {
    const userObjectId = this.userObjectId(userId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId, deleted: false })
      .lean<any>();
    if (!existing) return null;
    // 绑定路径也支持幂等重试，避免客户端重复提交造成无意义写入。
    if (dto.mutationId && existing.lastMutationId === dto.mutationId) {
      return this.serializeDoc(existing);
    }
    const safeDeviceId = this.sanitizeDeviceId(dto.deviceId);
    const updated = await this.docModel.findOneAndUpdate(
      { userId: userObjectId, fileId, deleted: false },
      {
        $set: {
          ...(safeDeviceId ? { [`deviceBindings.${safeDeviceId}`]: dto.devicePath } : {}),
          ...(dto.mutationId ? { lastMutationId: dto.mutationId } : {}),
        },
      },
      { new: true },
    ).lean<any>();
    return updated ? this.serializeDoc(updated) : null;
  }

  /**
   * 删除单个文件。
   * 采用墓碑标记保留版本信息，便于其他设备感知删除事件。
   */
  async deleteFile(userId: string, fileId: string, dto: DeleteFileDto) {
    const userObjectId = this.userObjectId(userId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId })
      .lean<any>();
    if (!existing) {
      return { fileId, deleted: true, rev: 0 };
    }
    // 重试同一次删除时直接返回现有墓碑状态。
    if (existing.lastMutationId && existing.lastMutationId === dto.mutationId) {
      return this.serializeDoc(existing);
    }
    if ((dto.baseRev ?? 0) !== existing.rev) {
      this.throwRevisionConflict(existing);
    }
    const updated = await this.docModel.findOneAndUpdate(
      { userId: userObjectId, fileId, rev: existing.rev },
      {
        $set: {
          deleted: true,
          deletedAt: new Date(),
          lastMutationId: dto.mutationId,
        },
        $inc: { rev: 1 },
      },
      { new: true },
    ).lean<any>();
    if (!updated) {
      const current = await this.docModel
        .findOne({ userId: userObjectId, fileId })
        .lean<any>();
      this.throwRevisionConflict(current);
    }
    return this.serializeDoc(updated);
  }

  /** 兼容旧客户端的批量删除包装器。 */
  async deleteDocuments(userId: string, fileIds: string[]) {
    let deleted = 0;
    for (const fileId of fileIds) {
      const current = await this.docModel
        .findOne({ userId: this.userObjectId(userId), fileId })
        .lean<any>();
      if (!current) continue;
      await this.deleteFile(userId, fileId, {
        baseRev: current.rev ?? 0,
        mutationId: `legacy-delete-${fileId}-${Date.now()}`,
      });
      deleted += 1;
    }
    return { deleted };
  }

  /** 清空用户文档并重置配置到当前协议版本。 */
  async resetState(userId: string) {
    const userObjectId = this.userObjectId(userId);
    await this.docModel.deleteMany({ userId: userObjectId });
    await this.configModel.updateOne(
      { userId: userObjectId },
      {
        $set: { protocolVersion: 2 },
        $unset: {
          recentFiles: '',
          bookmarks: '',
        },
      },
      { upsert: true },
    );
    return { reset: true };
  }

  /** 读取用户同步配置，不存在时自动初始化默认配置。 */
  async getConfig(userId: string) {
    let config = await this.configModel
      .findOne({ userId: this.userObjectId(userId) })
      .lean<Record<string, any>>();
    if (!config) {
      const created = await this.configModel.create({
        userId: this.userObjectId(userId),
        protocolVersion: 2,
        updatedAtMs: 0,
      });
      config = created.toObject();
    }
    const { _id, userId: uid, __v, ...rest } = config;
    return this.pickConfigFields(rest);
  }

  /** 更新用户同步配置，并同步写入毫秒级更新时间字段。 */
  async updateConfig(userId: string, data: UpdateConfigDto) {
    const sanitized = this.pickConfigFields({
      ...data,
      protocolVersion: 2,
    });
    await this.configModel.updateOne(
      { userId: this.userObjectId(userId) },
      { $set: { ...sanitized, updatedAtMs: sanitized.updatedAt } },
      { upsert: true },
    );
    return { updated: true };
  }
}
