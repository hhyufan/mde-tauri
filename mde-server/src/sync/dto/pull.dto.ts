import { IsArray, IsString } from 'class-validator';

/** 批量拉取或删除时使用的文件 ID 列表。 */
export class PullDto {
  /** 目标文件的稳定标识列表。 */
  @IsArray()
  @IsString({ each: true })
  fileIds: string[];
}
