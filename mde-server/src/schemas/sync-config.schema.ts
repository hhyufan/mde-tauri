import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class SyncConfig extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ default: 'light' })
  theme: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: 14 })
  fontSize: number;

  @Prop({ default: 'JetBrains Mono' })
  fontFamily: string;

  @Prop({ default: 24 })
  lineHeight: number;

  @Prop({ default: 2 })
  tabSize: number;

  @Prop({ default: true })
  wordWrap: boolean;

  @Prop({ default: true })
  lineNumbers: boolean;

  @Prop({ type: Object, default: { enabled: false } })
  minimap: Record<string, any>;

  @Prop({ default: true })
  autoSave: boolean;

  @Prop({ default: '' })
  workspacePath: string;

  @Prop({ type: Object, default: {} })
  editorState: Record<string, any>;

  @Prop({ default: 2 })
  protocolVersion: number;

  @Prop({ default: 0 })
  updatedAtMs: number;
}

export const SyncConfigSchema = SchemaFactory.createForClass(SyncConfig);
