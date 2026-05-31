import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CatalogosController } from './catalogos.controller';
import { CatalogosRepository } from './catalogos.repository';
import { CatalogosService } from './catalogos.service';

@Module({
  imports: [UsersModule],
  controllers: [CatalogosController],
  providers: [CatalogosService, CatalogosRepository],
})
export class CatalogosModule {}
