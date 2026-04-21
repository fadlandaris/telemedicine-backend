import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsultationMode,
  Prisma,
  SessionStatus,
  SessionType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import {
  CreateConsultationSessionDto,
  ListConsultationSessionsQueryDto,
} from './dto/consultations.dto';

const sessionWithProfilesInclude =
  Prisma.validator<Prisma.ConsultationSessionInclude>()({
    doctor: {
      include: {
        doctorProfile: {
          select: {
            fullName: true,
            license: true,
          },
        },
      },
    },
    patient: {
      include: {
        patientProfile: {
          select: {
            fullName: true,
          },
        },
      },
    },
    createdByAdmin: {
      include: {
        adminProfile: {
          select: {
            fullName: true,
          },
        },
      },
    },
    consultationNote: {
      select: {
        id: true,
        aiStatus: true,
      },
    },
  });

type SessionWithProfiles = Prisma.ConsultationSessionGetPayload<{
  include: typeof sessionWithProfilesInclude;
}>;

@Injectable()
export class ConsultationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toJakartaDate(date: string, time: string): Date {
    return new Date(`${date}T${time}:00+07:00`);
  }

  private toJakartaDateOnly(date: string): Date {
    return new Date(`${date}T00:00:00+07:00`);
  }

  private toJakartaDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .split('-');

    return `${parts[0]}${parts[1]}${parts[2]}`;
  }

  private nowInJakartaDateString(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private randomSuffix(length = 4): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  private assertScheduleWindow(start: Date, end: Date) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Tanggal atau jam schedule tidak valid');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException(
        'scheduledEndTime harus lebih besar dari scheduledStartTime',
      );
    }
  }

  private assertScheduleInFuture(start: Date) {
    const nowPlus3Min = new Date(Date.now() + 3 * 60 * 1000);
    if (start.getTime() < nowPlus3Min.getTime()) {
      throw new BadRequestException(
        'Jadwal konsultasi harus minimal 3 menit dari sekarang (WIB)',
      );
    }
  }

  private hasOverlap(
    aStart: Date,
    aEnd: Date | null,
    bStart: Date,
    bEnd: Date | null,
  ): boolean {
    const aEndMs = aEnd ? aEnd.getTime() : Number.POSITIVE_INFINITY;
    const bEndMs = bEnd ? bEnd.getTime() : Number.POSITIVE_INFINITY;
    return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
  }

  private assertRole(actual: UserRole, expected: UserRole) {
    if (actual !== expected) {
      throw new ForbiddenException('Role tidak diizinkan');
    }
  }

  private async generateUniqueSessionId(seedDate: Date): Promise<string> {
    const datePart = this.toJakartaDateKey(seedDate);
    for (let i = 0; i < 20; i++) {
      const candidate = `CS-${datePart}-${this.randomSuffix(4)}`;
      const exists = await this.prisma.consultationSession.findUnique({
        where: { sessionId: candidate },
        select: { sessionId: true },
      });
      if (!exists) return candidate;
    }
    throw new Error('Gagal generate session id unik');
  }

  private async generateUniqueRoomName(sessionId: string): Promise<string> {
    const base = `room_${sessionId.toLowerCase()}`;
    const exists = await this.prisma.consultationSession.findUnique({
      where: { roomName: base },
      select: { sessionId: true },
    });
    if (!exists) return base;

    for (let i = 0; i < 10; i++) {
      const candidate = `${base}_${this.randomSuffix(4).toLowerCase()}`;
      const roomExists = await this.prisma.consultationSession.findUnique({
        where: { roomName: candidate },
        select: { sessionId: true },
      });
      if (!roomExists) return candidate;
    }
    throw new Error('Gagal generate room name unik');
  }

  private normalizeSort(sort?: 'newest' | 'oldest') {
    if (sort === 'oldest') {
      return [{ scheduledStartTime: 'asc' as const }, { createdAt: 'asc' as const }];
    }
    return [{ scheduledStartTime: 'desc' as const }, { createdAt: 'desc' as const }];
  }

  private buildSearchClause(search?: string) {
    const keyword = search?.trim();
    if (!keyword) return {};

    return {
      OR: [
        {
          sessionId: {
            contains: keyword,
            mode: 'insensitive' as const,
          },
        },
        {
          patientName: {
            contains: keyword,
            mode: 'insensitive' as const,
          },
        },
        {
          roomName: {
            contains: keyword,
            mode: 'insensitive' as const,
          },
        },
        {
          doctor: {
            name: {
              contains: keyword,
              mode: 'insensitive' as const,
            },
          },
        },
        {
          patient: {
            name: {
              contains: keyword,
              mode: 'insensitive' as const,
            },
          },
        },
      ],
    };
  }

  private getPatientDisplayName(session: SessionWithProfiles): string | null {
    return (
      session.patientName ??
      session.patient.patientProfile?.fullName ??
      session.patient.name ??
      null
    );
  }

  private getDoctorDisplayName(session: SessionWithProfiles): string | null {
    return session.doctor.doctorProfile?.fullName ?? session.doctor.name ?? null;
  }

  private canDoctorJoinNow(session: SessionWithProfiles, now = new Date()): boolean {
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      return false;
    }
    if (session.doctorJoinedAt) return false;

    if (session.sessionType === 'INSTANT') {
      return true;
    }

    if (!session.scheduledEndTime) return false;
    return (
      now.getTime() >= session.scheduledStartTime.getTime() &&
      now.getTime() < session.scheduledEndTime.getTime()
    );
  }

  private canPatientJoinNow(session: SessionWithProfiles, now = new Date()): boolean {
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      return false;
    }
    if (session.patientJoinedAt) return false;

    if (session.sessionType === 'INSTANT') {
      return true;
    }

    if (!session.scheduledEndTime) return false;
    return (
      now.getTime() >= session.scheduledStartTime.getTime() &&
      now.getTime() < session.scheduledEndTime.getTime()
    );
  }

  private mapSession(session: SessionWithProfiles) {
    return {
      sessionId: session.sessionId,
      sessionType: session.sessionType,
      consultationMode: session.consultationMode,
      sessionStatus: session.sessionStatus,
      scheduledDate: session.scheduledDate,
      scheduledStartTime: session.scheduledStartTime,
      scheduledEndTime: session.scheduledEndTime,
      durationMinutes: session.durationMinutes,
      doctorId: session.doctorId,
      doctorName: this.getDoctorDisplayName(session),
      patientId: session.patientId,
      patientName: this.getPatientDisplayName(session),
      createdBy: session.createdBy,
      createdByName:
        session.createdByAdmin.adminProfile?.fullName ??
        session.createdByAdmin.name ??
        null,
      doctorJoinedAt: session.doctorJoinedAt,
      patientJoinedAt: session.patientJoinedAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      roomName: session.roomName,
      canDoctorJoin: this.canDoctorJoinNow(session),
      canPatientJoin: this.canPatientJoinNow(session),
      doctorJoinState: session.doctorJoinedAt
        ? 'JOINED'
        : this.canDoctorJoinNow(session)
          ? 'JOIN'
          : 'DISABLED',
      patientJoinState: session.patientJoinedAt
        ? 'JOINED'
        : this.canPatientJoinNow(session)
          ? 'JOIN'
          : 'DISABLED',
      consultationNote: session.consultationNote
        ? {
            id: session.consultationNote.id,
            aiStatus: session.consultationNote.aiStatus,
          }
        : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private async assertNoConflict(
    doctorId: string,
    patientId: string,
    start: Date,
    end: Date | null,
  ) {
    const activeSessions = await this.prisma.consultationSession.findMany({
      where: {
        OR: [{ doctorId }, { patientId }],
        sessionStatus: {
          in: ['CREATED', 'IN_CALL'],
        },
      },
      select: {
        sessionId: true,
        doctorId: true,
        patientId: true,
        scheduledStartTime: true,
        scheduledEndTime: true,
      },
    });

    for (const item of activeSessions) {
      const conflict = this.hasOverlap(
        item.scheduledStartTime,
        item.scheduledEndTime,
        start,
        end,
      );
      if (!conflict) continue;

      if (item.doctorId === doctorId) {
        throw new BadRequestException(
          `Dokter sudah punya jadwal bentrok dengan session ${item.sessionId}`,
        );
      }
      if (item.patientId === patientId) {
        throw new BadRequestException(
          `Patient sudah punya jadwal bentrok dengan session ${item.sessionId}`,
        );
      }
    }
  }

  private async findSessionWithProfilesById(sessionId: string) {
    return this.prisma.consultationSession.findUnique({
      where: { sessionId },
      include: sessionWithProfilesInclude,
    });
  }

  async createAudit(params: {
    consultationSessionId: string;
    action: string;
    actorUserId?: string | null;
    actorRole?: UserRole | null;
    previousStatus?: SessionStatus | null;
    newStatus?: SessionStatus | null;
    metadata?: Prisma.InputJsonObject | null;
  }) {
    const metadataValue =
      params.metadata === null
        ? Prisma.JsonNull
        : params.metadata === undefined
          ? undefined
          : params.metadata;

    await this.prisma.consultationSessionAudit.create({
      data: {
        consultationSessionId: params.consultationSessionId,
        action: params.action,
        actorUserId: params.actorUserId ?? null,
        actorRole: params.actorRole ?? null,
        previousStatus: params.previousStatus ?? null,
        newStatus: params.newStatus ?? null,
        metadata: metadataValue,
      },
    });
  }

  async createByAdmin(adminUserId: string, dto: CreateConsultationSessionDto) {
    const [admin, doctor, patient] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: adminUserId },
        select: { id: true, role: true, isActive: true },
      }),
      this.prisma.user.findUnique({
        where: { id: dto.doctorId },
        select: { id: true, role: true, isActive: true },
      }),
      this.prisma.user.findUnique({
        where: { id: dto.patientId },
        select: { id: true, role: true, isActive: true },
      }),
    ]);

    if (!admin || !admin.isActive) throw new ForbiddenException('Admin tidak valid');
    this.assertRole(admin.role, UserRole.ADMIN);

    if (!doctor || !doctor.isActive) {
      throw new BadRequestException('Dokter tidak valid');
    }
    this.assertRole(doctor.role, UserRole.DOCTOR);

    if (!patient || !patient.isActive) {
      throw new BadRequestException('Patient tidak valid');
    }
    this.assertRole(patient.role, UserRole.PATIENT);

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: doctor.id },
      select: { license: true },
    });

    if (!doctorProfile?.license?.trim()) {
      throw new BadRequestException(
        'Dokter tanpa license tidak bisa dijadwalkan konsultasi',
      );
    }

    let scheduledDate: Date;
    let scheduledStartTime: Date;
    let scheduledEndTime: Date | null;

    if (dto.sessionType === SessionType.SCHEDULED) {
      if (!dto.scheduledDate || !dto.scheduledStartTime || !dto.scheduledEndTime) {
        throw new BadRequestException(
          'Untuk SCHEDULED, scheduledDate, scheduledStartTime, scheduledEndTime wajib diisi',
        );
      }

      scheduledDate = this.toJakartaDateOnly(dto.scheduledDate);
      scheduledStartTime = this.toJakartaDate(
        dto.scheduledDate,
        dto.scheduledStartTime,
      );
      scheduledEndTime = this.toJakartaDate(dto.scheduledDate, dto.scheduledEndTime);

      this.assertScheduleWindow(scheduledStartTime, scheduledEndTime);
      this.assertScheduleInFuture(scheduledStartTime);
    } else {
      const now = new Date();
      const jakartaDate = this.nowInJakartaDateString();
      scheduledDate = this.toJakartaDateOnly(jakartaDate);
      scheduledStartTime = now;
      scheduledEndTime = null;
    }

    await this.assertNoConflict(
      doctor.id,
      patient.id,
      scheduledStartTime,
      scheduledEndTime,
    );

    const sessionId = await this.generateUniqueSessionId(scheduledDate);
    const roomName = await this.generateUniqueRoomName(sessionId);

    const created = await this.prisma.consultationSession.create({
      data: {
        sessionId,
        doctorId: doctor.id,
        patientId: patient.id,
        sessionType: dto.sessionType,
        consultationMode: dto.consultationMode,
        scheduledDate,
        scheduledStartTime,
        scheduledEndTime,
        sessionStatus: 'CREATED',
        createdBy: admin.id,
        roomName,
        recordingEnabled: dto.consultationMode === ConsultationMode.VIDEO,
      },
      include: sessionWithProfilesInclude,
    });

    await this.createAudit({
      consultationSessionId: created.sessionId,
      action: 'ADMIN_SESSION_CREATED',
      actorUserId: admin.id,
      actorRole: UserRole.ADMIN,
      previousStatus: null,
      newStatus: SessionStatus.CREATED,
      metadata: {
        sessionType: created.sessionType,
        consultationMode: created.consultationMode,
        scheduledStartTime: created.scheduledStartTime.toISOString(),
        scheduledEndTime: created.scheduledEndTime?.toISOString() ?? null,
      },
    });

    return this.mapSession(created);
  }

  async listAdminSessions(adminUserId: string, query: ListConsultationSessionsQueryDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, role: true },
    });
    if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
    this.assertRole(admin.role, UserRole.ADMIN);

    const whereClause: any = {
      createdBy: adminUserId,
      ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
      ...(query.status ? { sessionStatus: query.status } : {}),
      ...this.buildSearchClause(query.search),
    };

    const rows = await this.prisma.consultationSession.findMany({
      where: whereClause,
      orderBy: this.normalizeSort(query.sort),
      include: sessionWithProfilesInclude,
    });

    return rows.map((item) => this.mapSession(item));
  }

  async listAdminHistorySessions(
    adminUserId: string,
    query: ListConsultationSessionsQueryDto,
  ) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, role: true },
    });
    if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
    this.assertRole(admin.role, UserRole.ADMIN);

    const whereClause: any = {
      createdBy: adminUserId,
      ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
      ...this.buildSearchClause(query.search),
    };

    if (query.status) {
      whereClause.sessionStatus = query.status;
    } else {
      whereClause.sessionStatus = {
        in: [SessionStatus.COMPLETED, SessionStatus.FAILED],
      };
    }

    const rows = await this.prisma.consultationSession.findMany({
      where: whereClause,
      orderBy: this.normalizeSort(query.sort),
      include: sessionWithProfilesInclude,
    });

    return rows.map((item) => this.mapSession(item));
  }

  async listDoctorSessions(doctorId: string, query: ListConsultationSessionsQueryDto) {
    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorId },
      select: { id: true, role: true },
    });
    if (!doctor) throw new ForbiddenException('Dokter tidak ditemukan');
    this.assertRole(doctor.role, UserRole.DOCTOR);

    const whereClause: any = {
      doctorId,
      ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
      ...(query.status ? { sessionStatus: query.status } : {}),
      ...this.buildSearchClause(query.search),
    };

    const rows = await this.prisma.consultationSession.findMany({
      where: whereClause,
      orderBy: this.normalizeSort(query.sort),
      include: sessionWithProfilesInclude,
    });

    return rows.map((item) => this.mapSession(item));
  }

  async listPatientSessions(patientId: string, query: ListConsultationSessionsQueryDto) {
    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: { id: true, role: true },
    });
    if (!patient) throw new ForbiddenException('Patient tidak ditemukan');
    this.assertRole(patient.role, UserRole.PATIENT);

    const whereClause: any = {
      patientId,
      ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
      ...(query.status ? { sessionStatus: query.status } : {}),
      ...this.buildSearchClause(query.search),
    };

    const rows = await this.prisma.consultationSession.findMany({
      where: whereClause,
      orderBy: this.normalizeSort(query.sort),
      include: sessionWithProfilesInclude,
    });

    return rows.map((item) => this.mapSession(item));
  }

  async getSessionForDoctor(doctorId: string, sessionId: string) {
    const session = await this.findSessionWithProfilesById(sessionId);
    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.doctorId !== doctorId) {
      throw new ForbiddenException('Bukan session dokter ini');
    }
    return this.mapSession(session);
  }

  async getSessionForPatient(patientId: string, sessionId: string) {
    const session = await this.findSessionWithProfilesById(sessionId);
    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.patientId !== patientId) {
      throw new ForbiddenException('Bukan session patient ini');
    }
    return this.mapSession(session);
  }

  async getSessionForAdmin(adminId: string, sessionId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    });
    if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
    this.assertRole(admin.role, UserRole.ADMIN);

    const session = await this.findSessionWithProfilesById(sessionId);
    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.createdBy !== adminId) {
      throw new ForbiddenException('Bukan session yang dibuat admin ini');
    }
    return this.mapSession(session);
  }

  async getConsultationNote(doctorId: string, sessionId: string) {
    const note = await this.prisma.consultationNote.findFirst({
      where: {
        consultationSessionId: sessionId,
        doctorId,
      },
      include: {
        consultationSession: {
          select: {
            sessionId: true,
            sessionStatus: true,
            consultationMode: true,
            sessionType: true,
            scheduledStartTime: true,
            scheduledEndTime: true,
            patientName: true,
            patientIdentity: true,
          },
        },
      },
    });

    if (!note) return null;

    await this.createAudit({
      consultationSessionId: sessionId,
      action: 'DOCTOR_VIEW_SUMMARY',
      actorUserId: doctorId,
      actorRole: UserRole.DOCTOR,
      metadata: {
        noteId: note.id,
      },
    });

    return note;
  }

  async listDoctorOptions(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    });
    if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
    this.assertRole(admin.role, UserRole.ADMIN);

    const rows = await this.prisma.doctorProfile.findMany({
      where: {
        license: {
          not: '',
        },
        user: {
          isActive: true,
          role: UserRole.DOCTOR,
        },
      },
      select: {
        userId: true,
        fullName: true,
        email: true,
        phone: true,
        license: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return rows.map((item) => ({
      userId: item.userId,
      fullName: item.fullName,
      email: item.email,
      phone: item.phone,
      license: item.license,
    }));
  }

  async listPatientOptions(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    });
    if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
    this.assertRole(admin.role, UserRole.ADMIN);

    const rows = await this.prisma.patientProfile.findMany({
      where: {
        user: {
          isActive: true,
          role: UserRole.PATIENT,
        },
      },
      select: {
        userId: true,
        fullName: true,
        email: true,
        phone: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return rows.map((item) => ({
      userId: item.userId,
      fullName: item.fullName,
      email: item.email,
      phone: item.phone,
    }));
  }
}
