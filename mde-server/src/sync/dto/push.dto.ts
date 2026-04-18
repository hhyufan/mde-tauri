import {
  IsArray,
  IsBoolean,
  IsInt,
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
  @IsString()
  fileId: string;

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

export class PushDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PushFileDto)
  documents: PushFileDto[];
}
