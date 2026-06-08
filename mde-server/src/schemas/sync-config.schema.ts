import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/** 用户级同步配置模型。 */
@Schema({ timestamps: true })
export class SyncConfig extends Document {
  /** 配置所属用户。 */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  /** 主题模式。 */
  @Prop({ default: 'light' })
  theme: string;

  /** 语言设置。 */
  @Prop({ default: 'en' })
  language: string;

  /** 字号。 */
  @Prop({ default: 14 })
  fontSize: number;

  /** 字体族。 */
  @Prop({ default: 'JetBrains Mono' })
  fontFamily: string;

  /** 行高。 */
  @Prop({ default: 24 })
  lineHeight: number;

  /** Tab 宽度。 */
  @Prop({ default: 2 })
  tabSize: number;

  /** 是否启用自动换行。 */
  @Prop({ default: true })
  wordWrap: boolean;

  /** 是否显示行号。 */
  @Prop({ default: true })
  lineNumbers: boolean;

  /** 小地图设置。 */
  @Prop({ type: Object, default: { enabled: false } })
  minimap: Record<string, any>;

  /** 是否自动保存。 */
  @Prop({ default: true })
  autoSave: boolean;

  /** 当前工作区路径。 */
  @Prop({ default: '' })
  workspacePath: string;

  /** 编辑器状态快照。 */
  @Prop({ type: Object, default: {} })
  editorState: Record<string, any>;

  /** 当前同步协议版本。 */
  @Prop({ default: 2 })
  protocolVersion: number;

  /** 最近一次配置更新时间，单位毫秒。 */
  @Prop({ default: 0 })
  updatedAtMs: number;
}

export const SyncConfigSchema = SchemaFactory.createForClass(SyncConfig);
