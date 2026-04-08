import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { SummaryService } from './summary.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
  ) {}

  async processConsultationFromTranscript(
    consultationId: string,
    doctorId?: string,
  ) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        consultationNote: true,
      },
    });

    if (!consultation) {
      throw new Error(`Consultation not found: ${consultationId}`);
    }

    if (doctorId && consultation.doctorId !== doctorId) {
      throw new ForbiddenException('Bukan milik dokter ini');
    }

    const currentStatus = String(
      consultation.consultationNote?.aiStatus ?? '',
    )
      .trim()
      .toUpperCase();

    if (currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS') {
      return;
    }

    const transcriptRaw = String(
      consultation.consultationNote?.transcriptRaw ?? '',
    ).trim();

    const upsertStatus = async (
      aiStatus: string,
      extra: Record<string, any> = {},
    ) => {
      await this.prisma.consultationNote.upsert({
        where: { consultationId },
        update: {
          doctorId: consultation.doctorId,
          aiStatus,
          aiError: null,
          ...extra,
        },
        create: {
          consultationId,
          doctorId: consultation.doctorId,
          aiStatus,
          aiError: null,
          ...extra,
        },
      });
    };

    if (!transcriptRaw) {
      await upsertStatus('WAITING_TRANSCRIPT');
      this.logger.warn(
        `Transcript empty for consultationId=${consultationId}`,
      );
      return;
    }

    try {
      await upsertStatus('SUMMARIZING', {
        transcriptRaw,
        transcribedAt:
          consultation.consultationNote?.transcribedAt ?? new Date(),
      });

      const summary = await this.summaryService.createMedicalSummary(transcriptRaw);

      await this.prisma.consultationNote.upsert({
        where: { consultationId },
        update: {
          doctorId: consultation.doctorId,
          transcriptRaw,
          summary: summary.summary,
          subjective: summary.subjective,
          objective: summary.objective,
          assessment: summary.assessment,
          plan: summary.plan,
          aiStatus: 'SUCCESS',
          aiError: null,
          summarizedAt: new Date(),
          transcribedAt:
            consultation.consultationNote?.transcribedAt ?? new Date(),
        },
        create: {
          consultationId,
          doctorId: consultation.doctorId,
          transcriptRaw,
          summary: summary.summary,
          subjective: summary.subjective,
          objective: summary.objective,
          assessment: summary.assessment,
          plan: summary.plan,
          aiStatus: 'SUCCESS',
          aiError: null,
          summarizedAt: new Date(),
          transcribedAt:
            consultation.consultationNote?.transcribedAt ?? new Date(),
        },
      });

      this.logger.log(
        `AI summary completed for consultationId=${consultationId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `AI summary failed consultationId=${consultationId} message=${error?.message || error}`,
      );

      await this.prisma.consultationNote.upsert({
        where: { consultationId },
        update: {
          doctorId: consultation.doctorId,
          aiStatus: 'FAILED',
          aiError: error?.message || String(error),
        },
        create: {
          consultationId,
          doctorId: consultation.doctorId,
          aiStatus: 'FAILED',
          aiError: error?.message || String(error),
        },
      });

      throw error;
    }
  }
}
