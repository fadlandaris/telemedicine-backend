import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { TwilioWebhookService } from './twilio.webhook.service';

@Controller('twilio/webhooks')
export class TwilioWebhookController {
  constructor(private readonly twilioWebhookService: TwilioWebhookService) {}

  @Post('video-room')
  @HttpCode(204)
  async videoRoom(@Body() body: Record<string, any>) {
    await this.twilioWebhookService.handleVideoWebhook(body);
  }
}