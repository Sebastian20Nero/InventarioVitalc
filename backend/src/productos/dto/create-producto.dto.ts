import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateProductoDto {
  @ApiProperty({ example: 'PAP-001' })
  @IsString()
  codigoInterno!: string;

  @ApiProperty({ example: 'Resma carta' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional({ example: 'Resma de papel tamaño carta' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({ example: '1' })
  @IsString()
  categoriaId!: string;

  @ApiProperty({ example: '3' })
  @IsString()
  unidadId!: string;

  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @IsNumberString()
  stockMinimo?: string;
}
