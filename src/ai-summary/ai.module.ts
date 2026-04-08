import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SummaryService } from './summary.service';
import { PrismaService } from 'prisma/prisma.service';
import { AiController } from './ai.controller';

@Module({
  controllers: [AiController],
  providers: [AiService, SummaryService, PrismaService],
  exports: [AiService],
})
export class AiModule {}
