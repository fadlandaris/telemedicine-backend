import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import {
  CreateConsultationSessionDto,
  ListConsultationSessionsQueryDto,
} from './dto/consultations.dto';
import { ConsultationsService } from './consultations.service';

@Controller('consultations')
@UseGuards(JwtGuard)
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  private requireRole(actual: UserRole, expected: UserRole) {
    if (actual !== expected) {
      throw new ForbiddenException('Role tidak diizinkan untuk endpoint ini');
    }
  }

  @Post('sessions')
  async createSession(@Req() req: any, @Body() dto: CreateConsultationSessionDto) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.createByAdmin(req.user.id, dto);
  }

  @Get('sessions/admin')
  async listAdminSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listAdminSessions(req.user.id, query);
  }

  @Get('sessions/admin/history')
  async listAdminHistorySessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listAdminHistorySessions(req.user.id, query);
  }

  @Get('sessions/doctor')
  async listDoctorSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
  ) {
    this.requireRole(req.user.role, UserRole.DOCTOR);
    return this.consultations.listDoctorSessions(req.user.id, query);
  }

  @Get('sessions/patient')
  async listPatientSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
  ) {
    this.requireRole(req.user.role, UserRole.PATIENT);
    return this.consultations.listPatientSessions(req.user.id, query);
  }

  @Get('sessions/:sessionId')
  async getSession(@Req() req: any, @Param('sessionId') sessionId: string) {
    if (req.user.role === UserRole.ADMIN) {
      return this.consultations.getSessionForAdmin(req.user.id, sessionId);
    }
    if (req.user.role === UserRole.DOCTOR) {
      return this.consultations.getSessionForDoctor(req.user.id, sessionId);
    }
    if (req.user.role === UserRole.PATIENT) {
      return this.consultations.getSessionForPatient(req.user.id, sessionId);
    }
    throw new ForbiddenException('Role tidak diizinkan');
  }

  @Get('sessions/:sessionId/note')
  async getSessionNote(@Req() req: any, @Param('sessionId') sessionId: string) {
    this.requireRole(req.user.role, UserRole.DOCTOR);
    return this.consultations.getConsultationNote(req.user.id, sessionId);
  }

  @Get('lookups/doctors')
  async listDoctors(@Req() req: any) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listDoctorOptions(req.user.id);
  }

  @Get('lookups/patients')
  async listPatients(@Req() req: any) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listPatientOptions(req.user.id);
  }
}
