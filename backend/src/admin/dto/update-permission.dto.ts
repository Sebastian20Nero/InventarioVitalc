import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class UpdatePermissionDto {
  @IsOptional()
  @Matches(/^[A-Z0-9_]+$/)
  key?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
