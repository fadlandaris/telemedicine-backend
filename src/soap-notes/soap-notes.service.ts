import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { UpdateSoapNoteDto } from './dto/soap-notes.dto';

export const SOAP_NOTE_UPDATED_EVENT = 'soap.note.updated';

const NOTE_INCLUDE = {
  consultationSession: {
    select: {
      sessionId: true,
      sessionStatus: true,
      consultationMode: true,
      sessionType: true,
      scheduledStartTime: true,
      scheduledEndTime: true,
      durationMinutes: true,
      doctor: {
        select: {
          id: true,
          doctorProfile: { select: { fullName: true } },
        },
      },
      patient: {
        select: {
          id: true,
          patientProfile: { select: { fullName: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class SoapNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async getNote(sessionId: string, userId: string, role: UserRole) {
    const note = await this.prisma.consultationNote.findUnique({
      where: { consultationSessionId: sessionId },
      include: NOTE_INCLUDE,
    });

    if (!note) throw new NotFoundException('SOAP note tidak ditemukan');

    this.assertAccess(note, userId, role);

    if (role === UserRole.PATIENT && !note.isFinalized) {
      throw new ForbiddenException(
        'Dokter belum memfinalisasi hasil konsultasi ini',
      );
    }

    return this.mapNote(note);
  }

  async updateNote(
    sessionId: string,
    doctorId: string,
    dto: UpdateSoapNoteDto,
  ) {
    const note = await this.findAndAssertDoctor(sessionId, doctorId);

    const updated = await this.prisma.consultationNote.update({
      where: { id: note.id },
      data: {
        subjective: dto.subjective ?? note.subjective,
        objective: dto.objective ?? note.objective,
        assessment: dto.assessment ?? note.assessment,
        plan: dto.plan ?? note.plan,
      },
      include: NOTE_INCLUDE,
    });

    const mapped = this.mapNote(updated);
    this.events.emit(SOAP_NOTE_UPDATED_EVENT, {
      sessionId,
      note: mapped,
    });

    return mapped;
  }

  async finalizeNote(sessionId: string, doctorId: string) {
    const note = await this.findAndAssertDoctor(sessionId, doctorId);

    if (note.isFinalized) {
      throw new ForbiddenException('SOAP note sudah difinalisasi');
    }

    const updated = await this.prisma.consultationNote.update({
      where: { id: note.id },
      data: {
        isFinalized: true,
        finalizedAt: new Date(),
      },
      include: NOTE_INCLUDE,
    });

    const mapped = this.mapNote(updated);
    this.events.emit(SOAP_NOTE_UPDATED_EVENT, {
      sessionId,
      note: mapped,
    });

    return mapped;
  }

  /**
   * Lightweight ownership check for SSE — does NOT require isFinalized.
   * Patients can subscribe to the stream before doctor finalizes so they
   * receive the finalization event in real time.
   */
  async verifyStreamAccess(sessionId: string, userId: string, role: UserRole) {
    const note = await this.prisma.consultationNote.findUnique({
      where: { consultationSessionId: sessionId },
      select: { doctorId: true, patientId: true },
    });

    if (!note) throw new NotFoundException('SOAP note tidak ditemukan');
    this.assertAccess(note, userId, role);
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async findAndAssertDoctor(sessionId: string, doctorId: string) {
    const note = await this.prisma.consultationNote.findUnique({
      where: { consultationSessionId: sessionId },
    });

    if (!note) throw new NotFoundException('SOAP note tidak ditemukan');
    if (note.doctorId !== doctorId) {
      throw new ForbiddenException('Bukan SOAP note dokter ini');
    }

    return note;
  }

  private assertAccess(
    note: { doctorId: string; patientId: string },
    userId: string,
    role: UserRole,
  ) {
    if (role === UserRole.DOCTOR && note.doctorId !== userId) {
      throw new ForbiddenException('Bukan SOAP note dokter ini');
    }
    if (role === UserRole.PATIENT && note.patientId !== userId) {
      throw new ForbiddenException('Bukan SOAP note pasien ini');
    }
    if (role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin tidak dapat mengakses SOAP note');
    }
  }

  private mapNote(note: any) {
    const session = note.consultationSession;
    return {
      id: note.id,
      consultationSessionId: note.consultationSessionId,
      doctorId: note.doctorId,
      patientId: note.patientId,
      doctorName: session?.doctor?.doctorProfile?.fullName ?? null,
      patientName: session?.patient?.patientProfile?.fullName ?? null,
      scheduledStartTime: session?.scheduledStartTime ?? null,
      scheduledEndTime: session?.scheduledEndTime ?? null,
      durationMinutes: session?.durationMinutes ?? null,
      sessionStatus: session?.sessionStatus ?? null,
      consultationMode: session?.consultationMode ?? null,
      sessionType: session?.sessionType ?? null,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      summary: note.summary,
      aiStatus: note.aiStatus,
      aiError: note.aiError,
      isFinalized: note.isFinalized,
      finalizedAt: note.finalizedAt,
      transcribedAt: note.transcribedAt,
      summarizedAt: note.summarizedAt,
      aiModel: note.aiModel,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }
}
