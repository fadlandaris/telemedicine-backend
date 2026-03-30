import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GetAiResultsQueryDto } from './dto/ai-results.dto';

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
              {
                summary: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                subjective: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                objective: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                assessment: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                plan: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                transcriptRaw: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                aiStatus: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                consultation: {
                  roomName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                consultation: {
                  patientIdentity: {
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
        consultation: {
          select: {
            id: true,
            status: true,
            roomName: true,
            patientName: true,
            patientIdentity: true,
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
                durationSec: true,
                status: true,
                roomSid: true,
                roomName: true,
                createdAt: true,
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
        roomName: item.consultation.roomName,
        patientName: item.consultation.patientName ?? null,
        patientIdentity: item.consultation.patientIdentity,
        consultationStatus: item.consultation.status,
        consultationStartedAt: item.consultation.startedAt,
        consultationEndedAt: item.consultation.endedAt,
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
        callSession: item.consultation.callSession
          ? {
              id: item.consultation.callSession.id,
              durationSec: item.consultation.callSession.durationSec,
              status: item.consultation.callSession.status,
              roomSid: item.consultation.callSession.roomSid,
              roomName: item.consultation.callSession.roomName,
              createdAt: item.consultation.callSession.createdAt,
            }
          : null,
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

  async findById(doctorId: string, id: string) {
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
            patientName: true,
            patientIdentity: true,
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
      throw new NotFoundException('AI summary tidak ditemukan');
    }

    return {
      id: note.id,
      consultationId: note.consultationId,
      doctorId: note.doctorId,
      doctorName: note.consultation.doctor?.name ?? null,
      roomName: note.consultation.roomName,
      patientName: note.consultation.patientName ?? null,
      patientIdentity: note.consultation.patientIdentity,
      consultationStatus: note.consultation.status,
      consultationStartedAt: note.consultation.startedAt,
      consultationEndedAt: note.consultation.endedAt,
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
      callSession: note.consultation.callSession,
    };
  }
}
