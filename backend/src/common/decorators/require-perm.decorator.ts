import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION = 'required_permission';
export const RequirePerm = (permission: string) => SetMetadata(REQUIRED_PERMISSION, permission);
