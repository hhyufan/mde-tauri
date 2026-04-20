import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single document payload — used by both the per-file endpoint
 * (`POST /sync/file`) and the legacy batch push (`POST /sync/push`).
 */
export class PushFileDto {
  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  originalPath?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  compressed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  @IsOptional()
  @IsString()
  encoding?: string;

  @IsOptional()
  @IsString()
  lineEnding?: string;

  @IsString()
  checksum: string;

  @IsInt()
  @Min(0)
  baseRev: number;

  @IsString()
  mutationId: string;

  /**
   * Stable per-device identifier of the pushing client. Used together with
   * `devicePath` to register where this device keeps the file locally.
   */
  @IsOptional()
  @IsString()
  deviceId?: string;

  /**
   * Absolute local path of the file on the pushing device. When provided
   * together with `deviceId` the server stores it in `devicePaths[deviceId]`
   * so subsequent pulls from the same device know where to write.
   */
  @IsOptional()
  @IsString()
  devicePath?: string;
}

export class BindPathDto {
  @IsString()
  deviceId: string;

  @IsString()
  devicePath: string;

  @IsOptional()
  @IsString()
  mutationId?: string;
}

export class DeleteFileDto {
  @IsInt()
  @Min(0)
  baseRev: number;

  @IsString()
  mutationId: string;
}

export class UpdateConfigDto {
  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsInt()
  fontSize?: number;

  @IsOptional()
  @IsString()
  fontFamily?: string;

  @IsOptional()
  @IsInt()
  lineHeight?: number;

  @IsOptional()
  @IsInt()
  tabSize?: number;

  @IsOptional()
  @IsBoolean()
  wordWrap?: boolean;

  @IsOptional()
  @IsBoolean()
  lineNumbers?: boolean;

  @IsOptional()
  @IsObject()
  minimap?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  autoSave?: boolean;

  @IsOptional()
  @IsString()
  workspacePath?: string;

  @IsOptional()
  @IsObject()
  editorState?: Record<string, any>;

  @IsOptional()
  @IsInt()
  protocolVersion?: number;

  @IsOptional()
  @IsInt()
  updatedAt?: number;
}

export class PushDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PushFileDto)
  documents: PushFileDto[];
}
