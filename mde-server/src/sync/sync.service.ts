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
 * Names of indexes from earlier schema versions that must be dropped before
 * the current `(userId, fileId)` model can write. Specifically the legacy
 * `userId_1_relativePath_1` unique index treats every new document (which
 * no longer has a `relativePath` field, so it serializes as `null`) as a
 * duplicate after the very first insert, which surfaces as E11000.
 */
const LEGACY_DOC_INDEXES = ['userId_1_relativePath_1'];

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectModel(SyncDocument.name) private docModel: Model<SyncDocument>,
    @InjectModel(SyncConfig.name) private configModel: Model<SyncConfig>,
  ) {}

  /**
   * One-shot self-heal on boot:
   * 1. Drop indexes left behind by previous schema versions.
   * 2. Hard-delete documents whose `fileId` is empty/null — these are
   *    orphans from the old `relativePath`-keyed schema that can never be
   *    addressed by fileId and therefore pollute every manifest response.
   */
  async onModuleInit() {
    // ── 1. Legacy index cleanup ──────────────────────────────────────────
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

    // ── 2. Purge orphan documents with no fileId ─────────────────────────
    // Old schema stored documents keyed by `relativePath`; those records
    // never received a `fileId`, so the field is null/undefined/empty.
    // They surface in every manifest response as un-deletable ghosts
    // because the client can only address documents by fileId.
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

  private userObjectId(userId: string): Types.ObjectId {
    return new Types.ObjectId(userId);
  }

  private sanitizeDeviceId(deviceId?: string): string {
    return deviceId ? deviceId.replace(/[.$]/g, '_') : '';
  }

  private pickConfigFields(config: Record<string, any>): Record<string, any> {
    return {
      theme: config.theme ?? 'light',
      language: config.language ?? 'en',
      fontSize: config.fontSize ?? 14,
      tabSize: config.tabSize ?? 2,
      wordWrap: config.wordWrap ?? true,
      lineNumbers: config.lineNumbers ?? true,
      autoSave: config.autoSave ?? true,
      workspacePath: config.workspacePath ?? '',
      editorState: config.editorState ?? {},
      protocolVersion:
        typeof config.protocolVersion === 'number' ? config.protocolVersion : 1,
    };
  }

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

  private throwRevisionConflict(current: any): never {
    throw new ConflictException({
      code: 'revision_conflict',
      current: current ? this.serializeDoc(current, true) : null,
    });
  }

  /**
   * Returns the metadata-only manifest of every (non-deleted) document the
   * user has on the cloud. Clients use it to decide what to push / pull.
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

  async pushFile(userId: string, fileId: string, doc: PushFileDto) {
    const userObjectId = this.userObjectId(userId);
    const safeDeviceId = this.sanitizeDeviceId(doc.deviceId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId })
      .lean<any>();

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
   * Legacy batch push, kept for callers that still send <= a few small
   * files at once. New clients should use `pushFile()` per file.
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
   * Fetch a single document's full body. Per-file pull keeps response
   * sizes well under Vercel's response budget.
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

  /** Legacy multi-file pull, by `fileIds`. */
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

  async bindPath(userId: string, fileId: string, dto: BindPathDto) {
    const userObjectId = this.userObjectId(userId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId, deleted: false })
      .lean<any>();
    if (!existing) return null;
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

  async deleteFile(userId: string, fileId: string, dto: DeleteFileDto) {
    const userObjectId = this.userObjectId(userId);
    const existing = await this.docModel
      .findOne({ userId: userObjectId, fileId })
      .lean<any>();
    if (!existing) {
      return { fileId, deleted: true, rev: 0 };
    }
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

  async getConfig(userId: string) {
    let config = await this.configModel
      .findOne({ userId: this.userObjectId(userId) })
      .lean<Record<string, any>>();
    if (!config) {
      const created = await this.configModel.create({
        userId: this.userObjectId(userId),
        protocolVersion: 2,
      });
      config = created.toObject();
    }
    const { _id, userId: uid, __v, ...rest } = config;
    return this.pickConfigFields(rest);
  }

  async updateConfig(userId: string, data: UpdateConfigDto) {
    const sanitized = this.pickConfigFields({
      ...data,
      protocolVersion: 2,
    });
    await this.configModel.updateOne(
      { userId: this.userObjectId(userId) },
      { $set: sanitized },
      { upsert: true },
    );
    return { updated: true };
  }
}
