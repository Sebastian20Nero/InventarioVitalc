import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION } from '../common/decorators/require-perm.decorator';
import { UsersService } from '../users/users.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requiredPermission = this.reflector.get<string>(
      REQUIRED_PERMISSION,
      context.getHandler(),
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const permissions = await this.usersService.getPermissions(user.userId);
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Permiso requerido: ${requiredPermission}`);
    }

    return true;
  }
}
