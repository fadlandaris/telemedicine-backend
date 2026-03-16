import { Module, forwardRef } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from 'prisma/prisma.service';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [forwardRef(() => TwilioModule)],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, PrismaService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}