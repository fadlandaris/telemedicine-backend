import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import {
  DoctorVideoTokenDto,
  PatientVideoTokenDto,
  VideoTranscriptionDto,
} from './dto/twilio.dto';
import { TwilioService } from './twilio.service';

const getClientIp = (req: any): string | null => {
  const forwarded = req.headers?.['x-forwarded-for'];
  const realIp = req.headers?.['x-real-ip'];
  const raw =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded) ??
    (Array.isArray(realIp) ? realIp[0] : realIp) ??
    req.ip ??
    req.connection?.remoteAddress ??
    null;

  if (!raw || typeof raw !== 'string') return null;
  const first = raw.split(',')[0]?.trim() ?? '';
  return first || null;
};

@Controller('twilio')
export class TwilioController {
  constructor(private readonly twilio: TwilioService) {}

  @UseGuards(JwtGuard)
  @Post('video/doctor-token')
  async doctorToken(@Req() req: any, @Body() dto: DoctorVideoTokenDto) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh join sebagai dokter');
    }
    return this.twilio.doctorToken(req.user.id, dto.sessionId);
  }

  @UseGuards(JwtGuard)
  @Post('video/patient-token')
  async patientToken(@Req() req: any, @Body() dto: PatientVideoTokenDto) {
    if (req.user.role !== UserRole.PATIENT) {
      throw new ForbiddenException('Hanya patient yang boleh join sebagai patient');
    }

    const reqIp = getClientIp(req);
    return this.twilio.patientToken(req.user.id, dto.sessionId, reqIp ?? dto.clientIp);
  }

  @UseGuards(JwtGuard)
  @Post('video/end/:sessionId')
  async endCall(@Req() req: any, @Param('sessionId') sessionId: string) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh mengakhiri call');
    }
    return this.twilio.completeConsultationRoom(sessionId, req.user.id);
  }

  @UseGuards(JwtGuard)
  @Get('video/result/:sessionId')
  async getCallResult(@Req() req: any, @Param('sessionId') sessionId: string) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang bisa melihat result call');
    }
    return this.twilio.getCallSessionResult(req.user.id, sessionId);
  }

  @UseGuards(JwtGuard)
  @Post('video/transcription')
  async saveTranscription(@Req() req: any, @Body() dto: VideoTranscriptionDto) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh kirim transcription');
    }
    return this.twilio.saveTranscription(req.user.id, dto);
  }
}

