import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** 批量拉取或删除时使用的文件 ID 列表。 */
export class PullDto {
  /** 目标文件的稳定标识列表。 */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  fileIds: string[];
}
