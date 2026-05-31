import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerm('ADMIN_ACCESS')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @RequirePerm('USER_READ')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Post('users')
  @RequirePerm('USER_CREATE')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:id')
  @RequirePerm('USER_UPDATE')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  @RequirePerm('USER_DELETE')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Put('users/:id/roles')
  @RequirePerm('ROLE_ASSIGN')
  setUserRoles(@Param('id') id: string, @Body() dto: SetUserRolesDto) {
    return this.adminService.setUserRoles(id, dto.roleIds);
  }

  @Get('roles')
  @RequirePerm('ROLE_READ')
  listRoles() {
    return this.adminService.listRoles();
  }

  @Post('roles')
  @RequirePerm('ROLE_CREATE')
  createRole(@Body() dto: CreateRoleDto) {
    return this.adminService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePerm('ROLE_UPDATE')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.adminService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePerm('ROLE_DELETE')
  deleteRole(@Param('id') id: string) {
    return this.adminService.deleteRole(id);
  }

  @Put('roles/:id/permisos')
  @RequirePerm('PERMISSION_ASSIGN')
  setRolePermissions(@Param('id') id: string, @Body() dto: SetRolePermissionsDto) {
    return this.adminService.setRolePermissions(id, dto.permissionIds);
  }

  @Get('permisos')
  @RequirePerm('PERMISSION_READ')
  listPermissions() {
    return this.adminService.listPermissions();
  }

  @Post('permisos')
  @RequirePerm('PERMISSION_CREATE')
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.adminService.createPermission(dto);
  }

  @Patch('permisos/:id')
  @RequirePerm('PERMISSION_UPDATE')
  updatePermission(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.adminService.updatePermission(id, dto);
  }

  @Delete('permisos/:id')
  @RequirePerm('PERMISSION_DELETE')
  deletePermission(@Param('id') id: string) {
    return this.adminService.deletePermission(id);
  }
}
