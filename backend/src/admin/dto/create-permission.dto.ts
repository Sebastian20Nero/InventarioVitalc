import { IsOptional, IsString, Matches } from 'class-validator';

export class CreatePermissionDto {
  @Matches(/^[A-Z0-9_]+$/)
  key!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}
