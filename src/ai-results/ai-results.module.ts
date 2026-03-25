import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { AiResultsController } from './ai.results.controller';
import { AiResultsService } from './ai-results.service';

@Module({
  controllers: [AiResultsController],
  providers: [AiResultsService, PrismaService],
  exports: [AiResultsService],
})
export class AiResultsModule {}