import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Req,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/consultations.dto';
import { JwtGuard } from 'src/auth/guards/jwt.guard';

@Controller('consultations')
export class ConsultationsController {
  constructor(private consultations: ConsultationsService) {}

  @UseGuards(JwtGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateConsultationDto) {
    const doctorId = req.user.id;

    const c = await this.consultations.createForDoctor(doctorId, dto);

    const baseUrl = process.env.APP_PUBLIC_BASE_URL || 'http://localhost:3000';

    return {
      id: c.id,
      linkToken: c.linkToken,
      roomName: c.roomName,
      status: c.status,
      expiresAt: c.expiresAt,
      url: `${baseUrl}/consultation/${c.linkToken}`,
    };
  }

  @Get('link/:linkToken')
  async getByLink(@Param('linkToken') linkToken: string) {
    const c = await this.consultations.getByLinkToken(linkToken);
    return {
      consultationId: c.id,
      roomName: c.roomName,
      doctorName: c.doctor.name ?? 'Doctor',
      status: c.status,
      expiresAt: c.expiresAt,
    };
  }

  @UseGuards(JwtGuard)
  @Post(':id/end')
  async endConsultation(@Req() req: any, @Param('id') id: string) {
    return this.consultations.endConsultation(req.user.id, id);
  }

  @UseGuards(JwtGuard)
  @Get(':id/call-session')
  async getCallSession(@Req() req: any, @Param('id') id: string) {
    return this.consultations.getCallSessionResult(req.user.id, id);
  }

  @UseGuards(JwtGuard)
  @Get(':id/note')
  async getNote(@Req() req: any, @Param('id') id: string) {
    return this.consultations.getConsultationNote(req.user.id, id);
  }
}