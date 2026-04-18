import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  username: string;

  @Prop({ default: null })
  passwordHash: string;

  @Prop({ default: null })
  avatar: string;

  @Prop({ default: null })
  oauthProvider: string;

  @Prop({ default: null })
  oauthId: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
