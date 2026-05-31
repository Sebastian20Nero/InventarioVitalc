import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateCategoriaDto {
  @ApiProperty({ example: 'Papelería' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional({ example: 'Elementos de papelería y oficina' })
  @IsOptional()
  @IsString()
  descripcion?: string;
}
