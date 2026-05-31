import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateProductoDto {
  @ApiPropertyOptional({ example: 'PAP-001' })
  @IsOptional()
  @IsString()
  codigoInterno?: string;

  @ApiPropertyOptional({ example: 'Resma carta' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'Resma de papel tamaño carta' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @IsString()
  unidadId?: string;

  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @IsNumberString()
  stockMinimo?: string;
}
