import { Controller, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtGuard } from 'src/auth/guards/jwt.guard';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('process/:consultationId')
  async process(@Param('consultationId') consultationId: string) {
    await this.aiService.processConsultationFromTranscript(consultationId);
    return { success: true };
  }

  @UseGuards(JwtGuard)
  @Post('retry/:consultationId')
  async retry(@Req() req: any, @Param('consultationId') consultationId: string) {
    void this.aiService
      .processConsultationFromTranscript(consultationId, req.user.id)
      .catch((err) => {
        this.logger.error(
          `Manual retry failed consultationId=${consultationId} message=${err?.message || err}`,
        );
      });

    return { success: true, queued: true };
  }
}
