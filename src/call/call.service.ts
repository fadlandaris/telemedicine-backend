import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GetCallsQueryDto, GetCallStatsQueryDto } from './dto/call.dto';

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

  private parseDateInput(
    value: string | undefined,
    endOfDay: boolean,
    field: string,
  ): Date | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);

      if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
      ) {
        throw new BadRequestException(`${field} tidak valid`);
      }

      const date = endOfDay
        ? new Date(year, month, day, 23, 59, 59, 999)
        : new Date(year, month, day, 0, 0, 0, 0);

      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`${field} tidak valid`);
      }

      return date;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} tidak valid`);
    }

    return parsed;
  }

  private normalizeTzOffset(offset?: string): number {
    if (!offset) return 0;

    const parsed = Number(offset);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new BadRequestException('tzOffset harus berupa angka');
    }

    const rounded = Math.trunc(parsed);
    if (rounded < -14 * 60 || rounded > 14 * 60) {
      throw new BadRequestException('tzOffset di luar batas yang valid');
    }

    return rounded;
  }

  private toDateKey(date: Date, tzOffsetMinutes: number): string {
    const shifted = new Date(date.getTime() - tzOffsetMinutes * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }

  private buildDateKeys(
    startDate: Date,
    endDate: Date,
    tzOffsetMinutes: number,
  ): string[] {
    const startKey = this.toDateKey(startDate, tzOffsetMinutes);
    const endKey = this.toDateKey(endDate, tzOffsetMinutes);

    const parseKey = (key: string) => {
      const [year, month, day] = key.split('-').map((part) => Number(part));
      return new Date(Date.UTC(year, month - 1, day));
    };

    const formatKey = (date: Date) => date.toISOString().slice(0, 10);

    const cursor = parseKey(startKey);
    const endCursor = parseKey(endKey);
    const keys: string[] = [];

    while (cursor <= endCursor) {
      keys.push(formatKey(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return keys;
  }

  async findAllByDoctor(doctorId: string, query: GetCallsQueryDto) {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor?.trim() || undefined;
    const search = query.search?.trim() || undefined;
    const status = query.status?.trim() || undefined;
    const sort = this.normalizeSort(query.sort);

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const whereClause: any = {
      doctorId,
      ...(status ? { status } : {}),
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
            patientCity: true,
            patientProvince: true,
            patientCountry: true,
            patientCountryCode: true,
            patientLatitude: true,
            patientLongitude: true,
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
        patientName: item.patientName ?? item.consultation.patientName ?? null,
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
        patientCity: item.consultation.patientCity,
        patientProvince: item.consultation.patientProvince,
        patientCountry: item.consultation.patientCountry,
        patientCountryCode: item.consultation.patientCountryCode,
        patientLatitude: item.consultation.patientLatitude,
        patientLongitude: item.consultation.patientLongitude,
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

  async getDailyStatistics(doctorId: string, query: GetCallStatsQueryDto) {
    const tzOffset = this.normalizeTzOffset(query.tzOffset);

    const endDate =
      this.parseDateInput(query.endDate, true, 'endDate') ??
      new Date(new Date().setHours(23, 59, 59, 999));

    const startDate =
      this.parseDateInput(query.startDate, false, 'startDate') ??
      new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() - 6,
        0,
        0,
        0,
        0,
      );

    if (startDate > endDate) {
      throw new BadRequestException('startDate tidak boleh lebih besar dari endDate');
    }

    const dateKeys = this.buildDateKeys(startDate, endDate, tzOffset);
    const buckets = new Map(
      dateKeys.map((key) => [key, { count: 0, seconds: 0 }]),
    );

    const rows = await this.prisma.callSession.findMany({
      where: {
        doctorId,
        status: { not: 'FAILED' },
        OR: [
          {
            endedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          {
            endedAt: null,
            startedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          {
            endedAt: null,
            startedAt: null,
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        ],
      },
      select: {
        endedAt: true,
        startedAt: true,
        createdAt: true,
        durationSec: true,
      },
    });

    for (const row of rows) {
      const baseDate = row.endedAt ?? row.startedAt ?? row.createdAt;
      if (!baseDate) continue;
      if (baseDate < startDate || baseDate > endDate) continue;

      const key = this.toDateKey(baseDate, tzOffset);
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.count += 1;
      bucket.seconds += typeof row.durationSec === 'number' ? row.durationSec : 0;
    }

    const dailyCounts = dateKeys.map((key) => buckets.get(key)?.count ?? 0);
    const dailyHours = dateKeys.map((key) => {
      const seconds = buckets.get(key)?.seconds ?? 0;
      return Number((seconds / 3600).toFixed(1));
    });

    return {
      startDate: dateKeys[0] ?? this.toDateKey(startDate, tzOffset),
      endDate:
        dateKeys[dateKeys.length - 1] ?? this.toDateKey(endDate, tzOffset),
      categories: dateKeys,
      dailyCounts,
      dailyHours,
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
