import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class ConfiguracionDsnubeDto {
  @ApiProperty({ example: 'https://api.dsnube.com' })
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiProperty({ example: 'usuario.integracion' })
  @IsString()
  usuario!: string;

  @ApiPropertyOptional({ example: 'password-seguro' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
