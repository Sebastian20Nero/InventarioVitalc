import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateProductoEstadoDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  activo!: boolean;
}
