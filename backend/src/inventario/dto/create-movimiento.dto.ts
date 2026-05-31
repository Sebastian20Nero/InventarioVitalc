import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export const TIPOS_MOVIMIENTO = [
  'SALDO_INICIAL',
  'ENTRADA',
  'ABASTECIMIENTO',
  'SALIDA',
  'AJUSTE_POSITIVO',
  'AJUSTE_NEGATIVO',
] as const;

export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export class CreateMovimientoDto {
  @ApiProperty({ example: '1' })
  @IsString()
  productoId!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  bodegaId!: string;

  @ApiProperty({ enum: TIPOS_MOVIMIENTO, example: 'ENTRADA' })
  @IsIn(TIPOS_MOVIMIENTO)
  tipoMovimiento!: TipoMovimiento;

  @ApiProperty({ example: '5' })
  @IsNumberString()
  cantidad!: string;

  @ApiPropertyOptional({ example: 'Compra inicial de inventario' })
  @IsOptional()
  @IsString()
  observacion?: string;
}
