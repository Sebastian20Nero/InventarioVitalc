import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class GuiaLecturaDto {
  @IsString()
  numero: string;

  @IsOptional()
  @IsInt()
  consecutivo?: number | null;

  @IsString()
  ciudad: string;

  @IsString()
  recaudo: string;

  @IsString()
  tipo: string;

  @IsString()
  textoRotulo: string;
}

export class ResumenLecturaDto {
  @IsString()
  sku: string;

  @IsString()
  idDropi: string;

  @IsString()
  nombre: string;

  @IsInt()
  @Min(0)
  cantidad: number;
}

export class GuardarCorteDto {
  @IsInt()
  @Min(1)
  numero: number;

  @IsString()
  firma: string;

  @IsString()
  transportadora: string;

  @IsString()
  fecha: string;

  @IsString()
  huella: string;

  @IsString()
  nombreArchivo: string;

  @IsInt()
  @Min(0)
  paginas: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuiaLecturaDto)
  guias: GuiaLecturaDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResumenLecturaDto)
  resumen: ResumenLecturaDto[];
}
