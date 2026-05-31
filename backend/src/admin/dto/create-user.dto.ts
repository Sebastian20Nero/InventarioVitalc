import { IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  nombres!: string;

  @IsString()
  apellidos!: string;

  @IsEmail()
  correo!: string;

  @IsOptional()
  @IsString()
  celular?: string;

  @IsString()
  @MinLength(4)
  password!: string;

  @IsOptional()
  @IsArray()
  roleIds?: string[];
}
