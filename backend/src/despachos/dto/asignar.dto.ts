import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class AsignarDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  usuarioIds: string[];
}
