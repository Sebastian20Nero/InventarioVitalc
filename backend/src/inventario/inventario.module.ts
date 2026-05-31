import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { InventarioController } from './inventario.controller';
import { InventarioRepository } from './inventario.repository';
import { InventarioService } from './inventario.service';

@Module({
  imports: [UsersModule],
  controllers: [InventarioController],
  providers: [InventarioService, InventarioRepository],
})
export class InventarioModule {}
