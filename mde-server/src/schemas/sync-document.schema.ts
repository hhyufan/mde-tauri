import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Cloud-synced document.
 *
 * Storage key is `(userId, fileId)` — `fileId` is a stable client-generated
 * UUID that survives across devices, replacing the old `relativePath` key
 * which was effectively the absolute path of the original device and broke
 * cross-device sync.
 *
 * `originalPath` / `fileName` are kept as metadata so a client can hint where
 * to restore the file locally, but they are NOT part of the identity.
 */
@Schema({ timestamps: true })
export class SyncDocument extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  fileId: string;

  @Prop({ default: '' })
  fileName: string;

  @Prop({ default: '' })
  originalPath: string;

  /** 'tab' | 'recent' | 'bookmark' | 'manual' */
  @Prop({ default: 'manual' })
  source: string;

  /**
   * File body. When `compressed=true` this is base64(gzip(rawUtf8Bytes));
   * otherwise it is the raw text. Encoding (`encoding` field) describes the
   * raw text's encoding regardless of compression.
   */
  @Prop({ default: '' })
  content: string;

  @Prop({ default: false })
  compressed: boolean;

  /** Raw uncompressed size in bytes. */
  @Prop({ default: 0 })
  size: number;

  @Prop({ default: 'UTF-8' })
  encoding: string;

  @Prop({ default: 'LF' })
  lineEnding: string;

  @Prop({ required: true })
  checksum: string;

  @Prop({ default: '' })
  contentHash: string;

  @Prop({ default: 0 })
  rev: number;

  @Prop({ default: false })
  deleted: boolean;

  @Prop({ default: '' })
  lastMutationId: string;

  /**
   * Per-device local file path map: `{ [deviceId]: absoluteLocalPath }`.
   *
   * Each device that has a real on-disk copy of this document records its
   * own path here so it can later refresh / save back to the same location.
   * Devices that have only seen the file via cloud sync (and never picked
   * a local destination) simply have no entry — they are "external" to this
   * document and must `Save As` on first save to register their path.
   */
  @Prop({ type: Object, default: {} })
  deviceBindings: Record<string, string>;

  @Prop({ default: null })
  deletedAt: Date;
}

export const SyncDocumentSchema = SchemaFactory.createForClass(SyncDocument);
SyncDocumentSchema.index({ userId: 1, fileId: 1 }, { unique: true });
