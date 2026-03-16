import { Controller, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('process/:consultationId')
  async process(@Param('consultationId') consultationId: string) {
    await this.aiService.processConsultationFromCallSession(consultationId);
    return { success: true };
  }
}