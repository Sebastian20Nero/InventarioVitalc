import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ImportarDsnubeDto {
  @ApiProperty({ example: ['MOV-2026-000001', 'MOV-2026-000002'] })
  @IsArray()
  @IsString({ each: true })
  consecutivos!: string[];
}
