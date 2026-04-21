import { Module } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioController } from './twilio.controller';
import { PrismaService } from 'prisma/prisma.service';
import { ConsultationsModule } from '../consultations/consultations.module';
import { TwilioWebhookController } from './twilio.webhook.controller';
import { TwilioWebhookService } from './twilio.webhook.service';
import { LocalStorageService } from 'src/video/local-storage.service';
import { AiModule } from 'src/ai-summary/ai.module';
import { VideoCallService } from './videocall.service';
import { VoiceCallService } from './voicecall.service';

@Module({
  imports: [ConsultationsModule, AiModule],
  controllers: [TwilioController, TwilioWebhookController],
  providers: [
    TwilioService,
    TwilioWebhookService,
    VideoCallService,
    VoiceCallService,
    PrismaService,
    LocalStorageService,
  ],
  exports: [TwilioService],
})
export class TwilioModule {}
