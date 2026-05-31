import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateUnidadDto {
  @ApiProperty({ example: 'Unidad' })
  @IsString()
  nombre!: string;

  @ApiProperty({ example: 'UND' })
  @IsString()
  abreviatura!: string;
}
