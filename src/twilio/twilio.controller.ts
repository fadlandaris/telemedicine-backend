import { Controller, Post, Body, UseGuards, Req, Param, Get } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { DoctorVideoTokenDto, GuestVideoTokenDto } from './dto/twilio.dto';
import { JwtGuard } from 'src/auth/guards/jwt.guard';

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
  if (!first) return null;

  return first;
};

const normalizeIp = (ip?: string | null): string | null => {
  if (!ip || typeof ip !== 'string') return null;
  let value = ip.trim();
  if (!value) return null;

  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }

  if (value.includes('.') && value.includes(':')) {
    value = value.split(':')[0];
  }

  return value || null;
};

const isPrivateIp = (ip?: string | null): boolean => {
  if (!ip) return true;

  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fd') || ip.startsWith('fc')) {
    return true;
  }

  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;

  return false;
};

@Controller('twilio')
export class TwilioController {
  constructor(private twilio: TwilioService) {}

  @UseGuards(JwtGuard)
  @Post('video/doctor-token')
  async doctorToken(@Req() req: any, @Body() dto: DoctorVideoTokenDto) {
    const doctorId = req.user.id;
    return this.twilio.doctorToken(doctorId, dto.consultationId);
  }

  @Post('video/guest-token')
  async guestToken(@Req() req: any, @Body() dto: GuestVideoTokenDto) {
    const reqIp = normalizeIp(getClientIp(req));
    const bodyIp = normalizeIp(dto.clientIp);

    const preferredIp = reqIp && !isPrivateIp(reqIp) ? reqIp : bodyIp ?? reqIp;

    return this.twilio.guestToken(dto.linkToken, dto.displayName, preferredIp);
  }

  @UseGuards(JwtGuard)
  @Post('video/end/:consultationId')
  async endCall(@Req() req: any, @Param('consultationId') consultationId: string) {
    return this.twilio.completeConsultationRoom(consultationId, req.user.id);
  }

  @UseGuards(JwtGuard)
  @Get('video/result/:consultationId')
  async getCallResult(@Req() req: any, @Param('consultationId') consultationId: string) {
    return this.twilio.getCallSessionResult(req.user.id, consultationId);
  }
}
