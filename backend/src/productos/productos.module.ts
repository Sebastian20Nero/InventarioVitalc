import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ProductosController } from './productos.controller';
import { ProductosRepository } from './productos.repository';
import { ProductosService } from './productos.service';

@Module({
  imports: [UsersModule],
  controllers: [ProductosController],
  providers: [ProductosService, ProductosRepository],
})
export class ProductosModule {}
