import { IsArray } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  permissionIds!: string[];
}
