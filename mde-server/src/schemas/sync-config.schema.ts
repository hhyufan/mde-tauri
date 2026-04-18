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

  @Prop({ default: 2 })
  tabSize: number;

  @Prop({ default: true })
  wordWrap: boolean;

  @Prop({ default: true })
  lineNumbers: boolean;

  @Prop({ default: true })
  autoSave: boolean;

  @Prop({ default: '' })
  workspacePath: string;

  @Prop({ type: [Object], default: [] })
  recentFiles: Record<string, any>[];

  @Prop({ type: [Object], default: [] })
  bookmarks: Record<string, any>[];

  @Prop({ type: Object, default: {} })
  editorState: Record<string, any>;
}

export const SyncConfigSchema = SchemaFactory.createForClass(SyncConfig);
