import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CallController } from './call.controller';
import { CallService } from './call.service';

@Module({
  controllers: [CallController],
  providers: [CallService, PrismaService],
  exports: [CallService],
})
export class CallModule {}