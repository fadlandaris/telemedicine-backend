import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from 'prisma/prisma.service';

@Module({
  controllers: [ConsultationsController],
  providers: [ConsultationsService, PrismaService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
