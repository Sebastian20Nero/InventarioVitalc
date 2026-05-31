import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateBodegaDto {
  @ApiProperty({ example: 'Bodega principal' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional({ example: 'Bodega central de almacenamiento' })
  @IsOptional()
  @IsString()
  descripcion?: string;
}
