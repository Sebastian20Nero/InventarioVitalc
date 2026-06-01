import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumberString, IsOptional, IsString } from 'class-validator';

const aNumberString = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? value : String(value);

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
  @Transform(aNumberString)
  @IsNumberString()
  stockMinimo?: string;
}
