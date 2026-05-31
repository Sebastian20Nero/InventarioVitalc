import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AccionEmpalmeDto {
  @ApiPropertyOptional({ example: 'Validado contra soporte físico' })
  @IsOptional()
  @IsString()
  observacion?: string;
}
