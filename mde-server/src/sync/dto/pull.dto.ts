import { IsArray, IsString } from 'class-validator';

export class PullDto {
  @IsArray()
  @IsString({ each: true })
  fileIds: string[];
}
