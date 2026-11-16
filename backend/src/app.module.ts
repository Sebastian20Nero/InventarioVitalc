import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';
import { CatalogosModule } from './catalogos/catalogos.module';
import { ProductosModule } from './productos/productos.module';
import { InventarioModule } from './inventario/inventario.module';
import { EmpalmeModule } from './empalme/empalme.module';
import { DespachosModule } from './despachos/despachos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    AdminModule,
    CatalogosModule,
    ProductosModule,
    InventarioModule,
    EmpalmeModule,
    DespachosModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
