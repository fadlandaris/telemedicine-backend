import { Module, forwardRef } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioController } from './twilio.controller';
import { PrismaService } from 'prisma/prisma.service';
import { ConsultationsModule } from '../consultations/consultations.module';
import { TwilioWebhookController } from './twilio.webhook.controller';
import { TwilioWebhookService } from './twilio.webhook.service';
import { LocalStorageService } from 'src/video/local-storage.service';
import { AiModule } from 'src/ai-summary/ai.module';

@Module({
  imports: [forwardRef(() => ConsultationsModule), AiModule],
  controllers: [TwilioController, TwilioWebhookController],
  providers: [TwilioService, TwilioWebhookService, PrismaService, LocalStorageService],
  exports: [TwilioService],
})
export class TwilioModule {}