import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { TranscriptionService } from './transcription.service';
import { SummaryService } from './summary.service';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { promises as fs } from 'fs';
import { basename, extname, join } from 'path';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transcriptionService: TranscriptionService,
    private readonly summaryService: SummaryService,
  ) {}

  private resolveLocalPathFromPublicUrl(publicUrl: string): string {
    const baseUrl =
      process.env.APP_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4000';

    if (!publicUrl.startsWith(baseUrl)) {
      throw new Error(`mediaUrl is not local upload url: ${publicUrl}`);
    }

    const relative = publicUrl.replace(baseUrl, '');
    return join(process.cwd(), relative);
  }

  private async ensureDir(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private async extractAudioFromMp4(mp4Path: string): Promise<string> {
    const audioDir = join(process.cwd(), 'uploads', 'audio');
    await this.ensureDir(audioDir);

    const fileBase = basename(mp4Path, extname(mp4Path));
    const wavPath = join(audioDir, `${fileBase}.wav`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(mp4Path)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .save(wavPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    return wavPath;
  }

  private async removeFileIfExists(filePath: string) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }

  async processConsultationFromCallSession(consultationId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        callSession: true,
        consultationNote: true,
      },
    });

    if (!consultation) {
      throw new Error(`Consultation not found: ${consultationId}`);
    }

    if (!consultation.callSession?.mediaUrl) {
      throw new Error(
        `CallSession.mediaUrl not found for consultation ${consultationId}`,
      );
    }

    await this.prisma.consultationNote.upsert({
      where: { consultationId },
      update: {
        doctorId: consultation.doctorId,
        aiStatus: 'PROCESSING',
        aiError: null,
      },
      create: {
        consultationId,
        doctorId: consultation.doctorId,
        aiStatus: 'PROCESSING',
      },
    });

    let audioPath: string | null = null;

    try {
      const mp4Path = this.resolveLocalPathFromPublicUrl(
        consultation.callSession.mediaUrl,
      );

      audioPath = await this.extractAudioFromMp4(mp4Path);

      const transcription =
        await this.transcriptionService.transcribeWithWhisper(audioPath);

      const transcriptRaw = String(transcription.text || '').trim();

      await this.prisma.consultationNote.upsert({
        where: { consultationId },
        update: {
          doctorId: consultation.doctorId,
          transcriptRaw,
          aiError: null,
        },
        create: {
          consultationId,
          doctorId: consultation.doctorId,
          transcriptRaw,
          aiStatus: 'PROCESSING',
        },
      });

      if (!transcriptRaw) {
        throw new Error('Transcript kosong dari faster-whisper, kualitas suara tidak bagus');
      }

      const summary =
        await this.summaryService.createMedicalSummary(transcriptRaw);

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
          aiStatus: 'COMPLETED',
          aiError: null,
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
          aiStatus: 'COMPLETED',
          aiError: null,
        },
      });

      this.logger.log(
        `AI pipeline completed for consultationId=${consultationId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `AI pipeline failed consultationId=${consultationId} message=${error?.message || error}`,
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
    } finally {
      if (audioPath) {
        await this.removeFileIfExists(audioPath);
      }
    }
  }
}