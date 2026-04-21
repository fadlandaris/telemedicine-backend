import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GetAiResultsQueryDto } from './dto/ai-results.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AiResultsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeLimit(limit?: string): number {
    const parsed = Number(limit ?? 10);

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new BadRequestException('limit harus berupa angka');
    }

    if (parsed < 1) return 1;
    if (parsed > 100) return 100;

    return Math.floor(parsed);
  }

  private normalizeSort(sort?: string): 'newest' | 'oldest' {
    if (sort === 'oldest') return 'oldest';
    return 'newest';
  }

  async findAllByDoctor(doctorId: string, query: GetAiResultsQueryDto) {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor?.trim() || undefined;
    const search = query.search?.trim() || undefined;
    const sort = this.normalizeSort(query.sort);

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const whereClause: any = {
      doctorId,
      ...(search
        ? {
            OR: [
              { summary: { contains: search, mode: 'insensitive' } },
              { subjective: { contains: search, mode: 'insensitive' } },
              { objective: { contains: search, mode: 'insensitive' } },
              { assessment: { contains: search, mode: 'insensitive' } },
              { plan: { contains: search, mode: 'insensitive' } },
              { transcriptRaw: { contains: search, mode: 'insensitive' } },
              { aiStatus: { contains: search, mode: 'insensitive' } },
              {
                consultationSession: {
                  sessionId: { contains: search, mode: 'insensitive' },
                },
              },
              {
                consultationSession: {
                  roomName: { contains: search, mode: 'insensitive' },
                },
              },
              {
                consultationSession: {
                  patientIdentity: { contains: search, mode: 'insensitive' },
                },
              },
              {
                consultationSession: {
                  patientName: { contains: search, mode: 'insensitive' },
                },
              },
              {
                consultationSession: {
                  doctor: { name: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    if (cursor) {
      const cursorRow = await this.prisma.consultationNote.findFirst({
        where: {
          id: cursor,
          doctorId,
        },
        select: { id: true },
      });

      if (!cursorRow) {
        throw new NotFoundException('Cursor tidak ditemukan untuk doctor ini');
      }
    }

    const rows = await this.prisma.consultationNote.findMany({
      where: whereClause,
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy,
      include: {
        consultationSession: {
          select: {
            sessionId: true,
            sessionStatus: true,
            roomName: true,
            patientName: true,
            patientIdentity: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            twilioRoomSid: true,
            doctorIdentity: true,
            consultationMode: true,
            sessionType: true,
            recordingStatus: true,
            compositionStatus: true,
            mediaUrl: true,
            mediaFormat: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            doctor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      data: items.map((item) => {
        const patientName = item.consultationSession.patientName ?? null;

        return {
          id: item.id,
          consultationId: item.consultationSessionId,
          sessionId: item.consultationSessionId,
          doctorId: item.doctorId,
          doctorName: item.consultationSession.doctor?.name ?? null,
          roomName: item.consultationSession.roomName,
          patientIdentity: item.consultationSession.patientIdentity,
          patientName,
          consultationStatus: item.consultationSession.sessionStatus,
          consultationMode: item.consultationSession.consultationMode,
          sessionType: item.consultationSession.sessionType,
          consultationStartedAt: item.consultationSession.startedAt,
          consultationEndedAt: item.consultationSession.endedAt,
          summary: item.summary,
          subjective: item.subjective,
          objective: item.objective,
          assessment: item.assessment,
          plan: item.plan,
          transcriptRaw: item.transcriptRaw,
          aiStatus: item.aiStatus,
          aiError: item.aiError,
          transcribedAt: item.transcribedAt,
          summarizedAt: item.summarizedAt,
          aiModel: item.aiModel,
          callSession: {
            id: item.consultationSession.sessionId,
            durationSec: item.consultationSession.durationSec,
            status: item.consultationSession.sessionStatus,
            roomSid: item.consultationSession.twilioRoomSid,
            roomName: item.consultationSession.roomName,
            patientIdentity: item.consultationSession.patientIdentity,
            patientName: item.consultationSession.patientName ?? null,
            createdAt: item.consultationSession.createdAt,
          },
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      pagination: {
        limit,
        nextCursor,
        hasMore,
        sort,
        search: search ?? null,
      },
    };
  }

  async findById(doctorId: string, id: string) {
    const note = await this.prisma.consultationNote.findFirst({
      where: {
        id,
        doctorId,
      },
      include: {
        consultationSession: {
          select: {
            sessionId: true,
            sessionStatus: true,
            consultationMode: true,
            sessionType: true,
            roomName: true,
            patientName: true,
            patientIdentity: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            twilioRoomSid: true,
            doctorIdentity: true,
            recordingStatus: true,
            compositionStatus: true,
            mediaUrl: true,
            mediaFormat: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            doctor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!note) {
      throw new NotFoundException('AI summary tidak ditemukan');
    }

    await this.prisma.consultationSessionAudit.create({
      data: {
        consultationSessionId: note.consultationSessionId,
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        action: 'DOCTOR_VIEW_SUMMARY',
        previousStatus: note.consultationSession.sessionStatus,
        newStatus: note.consultationSession.sessionStatus,
      },
    });

    return {
      id: note.id,
      consultationId: note.consultationSessionId,
      sessionId: note.consultationSessionId,
      doctorId: note.doctorId,
      doctorName: note.consultationSession.doctor?.name ?? null,
      roomName: note.consultationSession.roomName,
      patientIdentity: note.consultationSession.patientIdentity,
      patientName: note.consultationSession.patientName ?? null,
      consultationStatus: note.consultationSession.sessionStatus,
      consultationMode: note.consultationSession.consultationMode,
      sessionType: note.consultationSession.sessionType,
      consultationStartedAt: note.consultationSession.startedAt,
      consultationEndedAt: note.consultationSession.endedAt,
      summary: note.summary,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      transcriptRaw: note.transcriptRaw,
      aiStatus: note.aiStatus,
      aiError: note.aiError,
      transcribedAt: note.transcribedAt,
      summarizedAt: note.summarizedAt,
      aiModel: note.aiModel,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      callSession: {
        id: note.consultationSession.sessionId,
        status: note.consultationSession.sessionStatus,
        roomSid: note.consultationSession.twilioRoomSid,
        roomName: note.consultationSession.roomName,
        doctorIdentity: note.consultationSession.doctorIdentity,
        patientIdentity: note.consultationSession.patientIdentity,
        startedAt: note.consultationSession.startedAt,
        endedAt: note.consultationSession.endedAt,
        recordingStatus: note.consultationSession.recordingStatus,
        compositionStatus: note.consultationSession.compositionStatus,
        mediaUrl: note.consultationSession.mediaUrl,
        mediaFormat: note.consultationSession.mediaFormat,
        durationSec: note.consultationSession.durationSec,
        errorMessage: note.consultationSession.errorMessage,
        createdAt: note.consultationSession.createdAt,
        updatedAt: note.consultationSession.updatedAt,
      },
    };
  }
}

