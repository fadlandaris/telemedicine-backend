import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GetCallsQueryDto } from './dto/call.dto';

@Injectable()
export class CallService {
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

  async findAllByDoctor(doctorId: string, query: GetCallsQueryDto) {
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
              {
                roomName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                roomSid: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                doctorIdentity: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                patientIdentity: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                patientName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                consultation: {
                  patientName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                consultation: {
                  doctor: {
                    name: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    if (cursor) {
      const cursorRow = await this.prisma.callSession.findFirst({
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

    const rows = await this.prisma.callSession.findMany({
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
        consultation: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            patientName: true,
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
      data: items.map((item) => ({
        id: item.id,
        consultationId: item.consultationId,
        doctorId: item.doctorId,
        doctorName: item.consultation.doctor?.name ?? null,
        patientName: item.consultation.patientName ?? null,
        status: item.status,
        roomSid: item.roomSid,
        roomName: item.roomName,
        doctorIdentity: item.doctorIdentity,
        patientIdentity: item.patientIdentity,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        recordingEnabled: item.recordingEnabled,
        recordingStatus: item.recordingStatus,
        recordingStartedAt: item.recordingStartedAt,
        recordingCompletedAt: item.recordingCompletedAt,
        compositionSid: item.compositionSid,
        compositionStatus: item.compositionStatus,
        compositionStartedAt: item.compositionStartedAt,
        compositionReadyAt: item.compositionReadyAt,
        mediaUrl: item.mediaUrl,
        mediaFormat: item.mediaFormat,
        durationSec: item.durationSec,
        errorMessage: item.errorMessage,
        consultationStatus: item.consultation.status,
        consultationStartedAt: item.consultation.startedAt,
        consultationEndedAt: item.consultation.endedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: {
        limit,
        nextCursor,
        hasMore,
        sort,
        search: search ?? null,
      },
    };
  }

  async findDetailById(doctorId: string, id: string) {
    const note = await this.prisma.consultationNote.findFirst({
      where: {
        id,
        doctorId,
      },
      include: {
        consultation: {
          select: {
            id: true,
            status: true,
            roomName: true,
            startedAt: true,
            endedAt: true,
            doctor: {
              select: {
                id: true,
                name: true,
              },
            },
            callSession: {
              select: {
                id: true,
                status: true,
                roomSid: true,
                roomName: true,
                doctorIdentity: true,
                patientIdentity: true,
                startedAt: true,
                endedAt: true,
                recordingStatus: true,
                compositionStatus: true,
                mediaUrl: true,
                mediaFormat: true,
                durationSec: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!note) {
      throw new NotFoundException('Call detail tidak ditemukan');
    }

    return {
      id: note.id,
      consultationId: note.consultationId,
      doctorId: note.doctorId,
      doctorName: note.consultation.doctor?.name ?? null,
      consultationStatus: note.consultation.status,
      roomName: note.consultation.roomName,
      consultationStartedAt: note.consultation.startedAt,
      consultationEndedAt: note.consultation.endedAt,
      transcriptRaw: note.transcriptRaw,
      summary: note.summary,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      aiStatus: note.aiStatus,
      aiError: note.aiError,
      transcribedAt: note.transcribedAt,
      summarizedAt: note.summarizedAt,
      aiModel: note.aiModel,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      callSession: note.consultation.callSession,
    };
  }
}
