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
    sessionId: string,
    doctorId?: string,
  ) {
    const consultationSession = await this.prisma.consultationSession.findUnique({
      where: { sessionId },
      include: {
        consultationNote: true,
      },
    });

    if (!consultationSession) {
      throw new Error(`Consultation session not found: ${sessionId}`);
    }

    if (doctorId && consultationSession.doctorId !== doctorId) {
      throw new ForbiddenException('Bukan milik dokter ini');
    }

    const currentStatus = String(
      consultationSession.consultationNote?.aiStatus ?? '',
    )
      .trim()
      .toUpperCase();

    if (currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS') {
      return;
    }

    const transcriptRaw = String(
      consultationSession.consultationNote?.transcriptRaw ?? '',
    ).trim();

    const upsertStatus = async (
      aiStatus: string,
      extra: Record<string, any> = {},
    ) => {
      await this.prisma.consultationNote.upsert({
        where: { consultationSessionId: sessionId },
        update: {
          doctorId: consultationSession.doctorId,
          aiStatus,
          aiError: null,
          ...extra,
        },
        create: {
          consultationSessionId: sessionId,
          doctorId: consultationSession.doctorId,
          patientId: consultationSession.patientId,
          aiStatus,
          aiError: null,
          ...extra,
        },
      });
    };

    if (!transcriptRaw) {
      await this.prisma.consultationNote.upsert({
        where: { consultationSessionId: sessionId },
        update: {
          doctorId: consultationSession.doctorId,
          aiStatus: 'FAILED',
          aiError: 'Transcript kosong. Tidak ada percakapan yang terdeteksi.',
        },
        create: {
          consultationSessionId: sessionId,
          doctorId: consultationSession.doctorId,
          patientId: consultationSession.patientId,
          aiStatus: 'FAILED',
          aiError: 'Transcript kosong. Tidak ada percakapan yang terdeteksi.',
        },
      });
      this.logger.warn(
        `Transcript empty for sessionId=${sessionId}`,
      );
      return;
    }

    try {
      await upsertStatus('SUMMARIZING', {
        transcriptRaw,
        transcribedAt:
          consultationSession.consultationNote?.transcribedAt ?? new Date(),
      });

      const summary = await this.summaryService.createMedicalSummary(transcriptRaw);

      await this.prisma.consultationNote.upsert({
        where: { consultationSessionId: sessionId },
        update: {
          doctorId: consultationSession.doctorId,
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
            consultationSession.consultationNote?.transcribedAt ?? new Date(),
        },
        create: {
          consultationSessionId: sessionId,
          doctorId: consultationSession.doctorId,
          patientId: consultationSession.patientId,
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
            consultationSession.consultationNote?.transcribedAt ?? new Date(),
        },
      });

      this.logger.log(
        `AI summary completed for sessionId=${sessionId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `AI summary failed sessionId=${sessionId} message=${error?.message || error}`,
      );

      await this.prisma.consultationNote.upsert({
        where: { consultationSessionId: sessionId },
        update: {
          doctorId: consultationSession.doctorId,
          aiStatus: 'FAILED',
          aiError: error?.message || String(error),
        },
        create: {
          consultationSessionId: sessionId,
          doctorId: consultationSession.doctorId,
          patientId: consultationSession.patientId,
          aiStatus: 'FAILED',
          aiError: error?.message || String(error),
        },
      });

      throw error;
    }
  }
}
