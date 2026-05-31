import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AnularMovimientoDto {
  @ApiProperty({ example: 'Registro duplicado' })
  @IsString()
  @MinLength(3)
  motivo!: string;
}
