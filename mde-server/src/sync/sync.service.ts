import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SyncDocument } from '../schemas/sync-document.schema';
import { SyncConfig } from '../schemas/sync-config.schema';
import { PushFileDto } from './dto/push.dto';

@Injectable()
export class SyncService {
  constructor(
    @InjectModel(SyncDocument.name) private docModel: Model<SyncDocument>,
    @InjectModel(SyncConfig.name) private configModel: Model<SyncConfig>,
  ) {}

  /**
   * Returns the metadata-only manifest of every (non-deleted) document the
   * user has on the cloud. Clients use it to decide what to push / pull.
   */
  async getManifest(userId: string) {
    const docs = await this.docModel
      .find({ userId: new Types.ObjectId(userId), deletedAt: null })
      .select('fileId fileName originalPath source size checksum devicePaths updatedAt')
      .lean<
        {
          fileId: string;
          fileName: string;
          originalPath: string;
          source: string;
          size: number;
          checksum: string;
          devicePaths: Record<string, string>;
          updatedAt: Date;
        }[]
      >();
    return docs.map((d) => ({
      fileId: d.fileId,
      fileName: d.fileName,
      originalPath: d.originalPath,
      source: d.source,
      size: d.size,
      checksum: d.checksum,
      devicePaths: d.devicePaths || {},
      updatedAt: d.updatedAt,
    }));
  }

  /**
   * Single-file upsert. Preferred entry-point for the client because it
   * keeps each request small and side-steps the Vercel ~4.5MB function
   * body limit when called once per file.
   */
  async pushFile(userId: string, doc: PushFileDto) {
    const set: Record<string, any> = {
      fileName: doc.fileName ?? '',
      originalPath: doc.originalPath ?? '',
      source: doc.source ?? 'manual',
      content: doc.content,
      compressed: doc.compressed ?? false,
      size: doc.size ?? 0,
      encoding: doc.encoding ?? 'UTF-8',
      lineEnding: doc.lineEnding ?? 'LF',
      checksum: doc.checksum,
      deletedAt: null,
    };
    // Per-device path registration. Use dotted path so the rest of the
    // devicePaths map for other devices is preserved.
    if (doc.deviceId) {
      set[`devicePaths.${doc.deviceId}`] = doc.devicePath ?? '';
    }
    await this.docModel.updateOne(
      {
        userId: new Types.ObjectId(userId),
        fileId: doc.fileId,
      },
      { $set: set },
      { upsert: true },
    );
    return { fileId: doc.fileId, ok: true };
  }

  /**
   * Legacy batch push, kept for callers that still send <= a few small
   * files at once. New clients should use `pushFile()` per file.
   */
  async pushDocuments(userId: string, documents: PushFileDto[]) {
    const ops = documents.map((doc) => {
      const set: Record<string, any> = {
        fileName: doc.fileName ?? '',
        originalPath: doc.originalPath ?? '',
        source: doc.source ?? 'manual',
        content: doc.content,
        compressed: doc.compressed ?? false,
        size: doc.size ?? 0,
        encoding: doc.encoding ?? 'UTF-8',
        lineEnding: doc.lineEnding ?? 'LF',
        checksum: doc.checksum,
        deletedAt: null,
      };
      if (doc.deviceId) {
        set[`devicePaths.${doc.deviceId}`] = doc.devicePath ?? '';
      }
      return {
        updateOne: {
          filter: {
            userId: new Types.ObjectId(userId),
            fileId: doc.fileId,
          },
          update: { $set: set },
          upsert: true,
        },
      };
    });
    if (ops.length > 0) {
      await this.docModel.bulkWrite(ops as any);
    }
    return { pushed: documents.length };
  }

  /**
   * Fetch a single document's full body. Per-file pull keeps response
   * sizes well under Vercel's response budget.
   */
  async pullFile(userId: string, fileId: string) {
    const doc = await this.docModel
      .findOne({
        userId: new Types.ObjectId(userId),
        fileId,
        deletedAt: null,
      })
      .lean<{
        fileId: string;
        fileName: string;
        originalPath: string;
        source: string;
        content: string;
        compressed: boolean;
        size: number;
        encoding: string;
        lineEnding: string;
        checksum: string;
        devicePaths: Record<string, string>;
        updatedAt: Date;
      }>();
    if (!doc) return null;
    return {
      fileId: doc.fileId,
      fileName: doc.fileName,
      originalPath: doc.originalPath,
      source: doc.source,
      content: doc.content,
      compressed: doc.compressed,
      size: doc.size,
      encoding: doc.encoding,
      lineEnding: doc.lineEnding,
      checksum: doc.checksum,
      devicePaths: doc.devicePaths || {},
      updatedAt: doc.updatedAt,
    };
  }

  /** Legacy multi-file pull, by `fileIds`. */
  async pullDocuments(userId: string, fileIds: string[]) {
    const docs = await this.docModel
      .find({
        userId: new Types.ObjectId(userId),
        fileId: { $in: fileIds },
        deletedAt: null,
      })
      .lean<
        {
          fileId: string;
          fileName: string;
          originalPath: string;
          source: string;
          content: string;
          compressed: boolean;
          size: number;
          encoding: string;
          lineEnding: string;
          checksum: string;
          devicePaths: Record<string, string>;
          updatedAt: Date;
        }[]
      >();
    return docs.map((d) => ({
      fileId: d.fileId,
      fileName: d.fileName,
      originalPath: d.originalPath,
      source: d.source,
      content: d.content,
      compressed: d.compressed,
      size: d.size,
      encoding: d.encoding,
      lineEnding: d.lineEnding,
      checksum: d.checksum,
      devicePaths: d.devicePaths || {},
      updatedAt: d.updatedAt,
    }));
  }

  async deleteFile(userId: string, fileId: string) {
    await this.docModel.updateOne(
      { userId: new Types.ObjectId(userId), fileId },
      { $set: { deletedAt: new Date() } },
    );
    return { fileId, deleted: true };
  }

  async deleteDocuments(userId: string, fileIds: string[]) {
    await this.docModel.updateMany(
      { userId: new Types.ObjectId(userId), fileId: { $in: fileIds } },
      { $set: { deletedAt: new Date() } },
    );
    return { deleted: fileIds.length };
  }

  async getConfig(userId: string) {
    let config = await this.configModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean<Record<string, any>>();
    if (!config) {
      const created = await this.configModel.create({ userId: new Types.ObjectId(userId) });
      config = created.toObject();
    }
    const { _id, userId: uid, __v, ...rest } = config;
    return rest;
  }

  async updateConfig(userId: string, data: Record<string, any>) {
    const { _id, userId: uid, __v, ...safeData } = data;
    await this.configModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: safeData },
      { upsert: true },
    );
    return { updated: true };
  }
}
