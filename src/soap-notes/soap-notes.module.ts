import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { SoapNotesController } from './soap-notes.controller';
import { SoapNotesService } from './soap-notes.service';

@Module({
  imports: [PrismaModule],
  controllers: [SoapNotesController],
  providers: [SoapNotesService],
})
export class SoapNotesModule {}
