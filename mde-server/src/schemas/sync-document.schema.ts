import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * 云端同步文档模型。
 *
 * 文档的唯一键为 `(userId, fileId)`，其中 `fileId` 是客户端生成的稳定 ID，
 * 可以跨设备保持一致，替代旧版本依赖本地路径的标识方案。
 *
 * `originalPath` 和 `fileName` 仅作为展示与恢复提示信息保存，
 * 不参与文档身份判定。
 */
@Schema({ timestamps: true })
export class SyncDocument extends Document {
  /** 文档所属用户。 */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  /** 跨设备稳定一致的文件标识。 */
  @Prop({ required: true, index: true })
  fileId: string;

  /** 展示用文件名。 */
  @Prop({ default: '' })
  fileName: string;

  /** 文件最初来源路径。 */
  @Prop({ default: '' })
  originalPath: string;

  /** 文件来源类型，如 `tab`、`recent`、`bookmark`、`manual`。 */
  @Prop({ default: 'manual' })
  source: string;

  /**
   * 文件正文。
   * 当 `compressed=true` 时，这里存储压缩后的内容；否则为原始文本。
   */
  @Prop({ default: '' })
  content: string;

  /** 标记正文是否经过压缩。 */
  @Prop({ default: false })
  compressed: boolean;

  /** 原始未压缩内容大小，单位字节。 */
  @Prop({ default: 0 })
  size: number;

  /** 文本编码。 */
  @Prop({ default: 'UTF-8' })
  encoding: string;

  /** 行尾风格。 */
  @Prop({ default: 'LF' })
  lineEnding: string;

  /** 内容校验值。 */
  @Prop({ required: true })
  checksum: string;

  /** 额外保存的内容哈希。 */
  @Prop({ default: '' })
  contentHash: string;

  /** 当前文档修订号。 */
  @Prop({ default: 0 })
  rev: number;

  /** 是否已被逻辑删除。 */
  @Prop({ default: false })
  deleted: boolean;

  /** 最近一次变更的幂等 ID。 */
  @Prop({ default: '' })
  lastMutationId: string;

  /**
   * 按设备保存本地路径映射：`{ [deviceId]: absoluteLocalPath }`。
   * 这样同一份云端文档可以在不同设备上回写到各自的本地位置。
   */
  @Prop({ type: Object, default: {} })
  deviceBindings: Record<string, string>;

  /** 删除墓碑创建时间。 */
  @Prop({ default: null })
  deletedAt: Date;
}

export const SyncDocumentSchema = SchemaFactory.createForClass(SyncDocument);
/** 保证每个用户下的 `fileId` 全局唯一。 */
SyncDocumentSchema.index({ userId: 1, fileId: 1 }, { unique: true });
