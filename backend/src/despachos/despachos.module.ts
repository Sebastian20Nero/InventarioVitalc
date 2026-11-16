import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DespachosController } from './despachos.controller';
import { DespachosService } from './despachos.service';

@Module({
  imports: [UsersModule],
  controllers: [DespachosController],
  providers: [DespachosService],
})
export class DespachosModule {}
