import { IsArray } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  roleIds!: string[];
}
