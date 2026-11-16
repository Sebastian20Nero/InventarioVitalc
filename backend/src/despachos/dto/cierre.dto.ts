import { IsOptional, IsString } from 'class-validator';

export class EscanearDto {
  @IsString()
  codigo: string;
}

export class RepresarDto {
  @IsString()
  motivo: string;
}

export class ReprogramarDto {
  @IsString()
  corteDestinoId: string;
}

export class CerrarCorteDto {
  @IsString()
  auxiliar: string;

  @IsOptional()
  @IsString()
  placa?: string;

  @IsOptional()
  @IsString()
  hora?: string;

  @IsOptional()
  @IsString()
  motivoCierre?: string;
}

export class PrefijoDto {
  @IsString()
  transportadoraId: string;

  @IsString()
  prefijo: string;
}
