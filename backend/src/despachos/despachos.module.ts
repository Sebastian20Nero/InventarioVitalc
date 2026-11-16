import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DespachosController } from './despachos.controller';
import { DespachosService } from './despachos.service';

@Module({
  imports: [AuthModule],
  controllers: [DespachosController],
  providers: [DespachosService],
})
export class DespachosModule {}
