import { Controller, Post, Body, UseGuards, Req, Param, Get } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { DoctorVideoTokenDto, GuestVideoTokenDto } from './dto/twilio.dto';
import { JwtGuard } from 'src/auth/guards/jwt.guard';

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
  async guestToken(@Body() dto: GuestVideoTokenDto) {
    return this.twilio.guestToken(dto.linkToken, dto.displayName);
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