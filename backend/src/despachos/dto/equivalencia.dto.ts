import { IsString } from 'class-validator';

export class EquivalenciaDto {
  @IsString()
  sku: string;

  @IsString()
  idDropi: string;

  @IsString()
  nombre: string;

  @IsString()
  productoId: string;
}
