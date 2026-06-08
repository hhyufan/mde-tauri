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
 * 单文件同步载荷。
 * 同时用于单文件接口与旧版批量推送接口。
 */
export class PushFileDto {
  /** 文件的稳定 ID；单文件接口通常由路由参数提供。 */
  @IsOptional()
  @IsString()
  fileId?: string;

  /** 展示用文件名。 */
  @IsOptional()
  @IsString()
  fileName?: string;

  /** 文件最初来源路径，仅作为元数据保存。 */
  @IsOptional()
  @IsString()
  originalPath?: string;

  /** 文件来源类型，如手动创建、最近打开等。 */
  @IsOptional()
  @IsString()
  source?: string;

  /** 文件正文；若 `compressed=true` 则为压缩后的字符串。 */
  @IsString()
  content: string;

  /** 标记 `content` 是否经过压缩。 */
  @IsOptional()
  @IsBoolean()
  compressed?: boolean;

  /** 原始未压缩文件大小。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  /** 文件编码。 */
  @IsOptional()
  @IsString()
  encoding?: string;

  /** 行尾风格，如 `LF` 或 `CRLF`。 */
  @IsOptional()
  @IsString()
  lineEnding?: string;

  /** 内容校验值，用于检测变更。 */
  @IsString()
  checksum: string;

  /** 客户端认为当前文件基于的服务端版本号。 */
  @IsInt()
  @Min(0)
  baseRev: number;

  /** 客户端生成的变更 ID，用于实现幂等重试。 */
  @IsString()
  mutationId: string;

  /**
   * 推送该文件的设备稳定标识。
   * 与 `devicePath` 一起用于记录该设备本地保存位置。
   */
  @IsOptional()
  @IsString()
  deviceId?: string;

  /**
   * 推送设备上的本地绝对路径。
   * 与 `deviceId` 一起提交时，服务端会把它写入设备路径映射。
   */
  @IsOptional()
  @IsString()
  devicePath?: string;
}

/** 绑定设备与本地路径的请求体。 */
export class BindPathDto {
  /** 设备稳定标识。 */
  @IsString()
  deviceId: string;

  /** 该设备上的本地绝对路径。 */
  @IsString()
  devicePath: string;

  /** 可选的幂等变更 ID。 */
  @IsOptional()
  @IsString()
  mutationId?: string;
}

/** 单文件删除请求体。 */
export class DeleteFileDto {
  /** 删除时客户端基于的当前版本号。 */
  @IsInt()
  @Min(0)
  baseRev: number;

  /** 删除操作的唯一变更 ID。 */
  @IsString()
  mutationId: string;
}

/** 用户编辑器同步配置更新请求体。 */
export class UpdateConfigDto {
  /** 主题模式。 */
  @IsOptional()
  @IsString()
  theme?: string;

  /** 界面语言。 */
  @IsOptional()
  @IsString()
  language?: string;

  /** 编辑器字号。 */
  @IsOptional()
  @IsInt()
  fontSize?: number;

  /** 编辑器字体族。 */
  @IsOptional()
  @IsString()
  fontFamily?: string;

  /** 行高。 */
  @IsOptional()
  @IsInt()
  lineHeight?: number;

  /** Tab 宽度。 */
  @IsOptional()
  @IsInt()
  tabSize?: number;

  /** 是否自动换行。 */
  @IsOptional()
  @IsBoolean()
  wordWrap?: boolean;

  /** 是否显示行号。 */
  @IsOptional()
  @IsBoolean()
  lineNumbers?: boolean;

  /** 小地图配置。 */
  @IsOptional()
  @IsObject()
  minimap?: Record<string, any>;

  /** 是否启用自动保存。 */
  @IsOptional()
  @IsBoolean()
  autoSave?: boolean;

  /** 当前工作区路径。 */
  @IsOptional()
  @IsString()
  workspacePath?: string;

  /** 编辑器界面状态快照。 */
  @IsOptional()
  @IsObject()
  editorState?: Record<string, any>;

  /** 协议版本字段，服务端会按当前版本做归一化。 */
  @IsOptional()
  @IsInt()
  protocolVersion?: number;

  /** 配置更新时间戳，单位毫秒。 */
  @IsOptional()
  @IsInt()
  updatedAt?: number;
}

/** 兼容旧版接口的批量推送请求体。 */
export class PushDto {
  /** 待批量推送的文件列表。 */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PushFileDto)
  documents: PushFileDto[];
}
