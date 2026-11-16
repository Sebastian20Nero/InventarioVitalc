import { IsBoolean, IsIn } from 'class-validator';

export class EtapaDto {
  @IsIn(['revisado', 'embolsado', 'empacado'])
  etapa: 'revisado' | 'embolsado' | 'empacado';

  @IsBoolean()
  hecho: boolean;
}
