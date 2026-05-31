import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { EmpalmeController } from './empalme.controller';
import { EmpalmeRepository } from './empalme.repository';
import { EmpalmeService } from './empalme.service';

@Module({
  imports: [UsersModule],
  controllers: [EmpalmeController],
  providers: [EmpalmeService, EmpalmeRepository],
})
export class EmpalmeModule {}
