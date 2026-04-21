import {
  Controller,
  ForbiddenException,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AiService } from './ai.service';
import { JwtGuard } from 'src/auth/guards/jwt.guard';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('process/:sessionId')
  async process(@Param('sessionId') sessionId: string) {
    await this.aiService.processConsultationFromTranscript(sessionId);
    return { success: true };
  }

  @UseGuards(JwtGuard)
  @Post('retry/:sessionId')
  async retry(@Req() req: any, @Param('sessionId') sessionId: string) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat retry AI summary');
    }

    void this.aiService
      .processConsultationFromTranscript(sessionId, req.user.id)
      .catch((err) => {
        this.logger.error(
          `Manual retry failed sessionId=${sessionId} message=${err?.message || err}`,
        );
      });

    return { success: true, queued: true };
  }
}
