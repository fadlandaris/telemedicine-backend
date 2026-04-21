import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ConsultationMode,
  SessionStatus,
  SessionType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiService } from 'src/ai-summary/ai.service';
import { LocalStorageService } from 'src/video/local-storage.service';
import { PrismaService } from 'prisma/prisma.service';
import { ConsultationsService } from 'src/consultations/consultations.service';
import { VideoTranscriptionDto } from './dto/twilio.dto';
import { VideoCallService } from './videocall.service';
import { VoiceCallService } from './voicecall.service';

@Injectable()
export class TwilioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TwilioService.name);
  private readonly statusCallbackUrl =
    process.env.TWILIO_VIDEO_STATUS_CALLBACK_URL ||
    `${process.env.APP_BASE_URL}/twilio/webhooks/video-room`;

  private autoEndTimer: NodeJS.Timeout | null = null;
  private autoEndRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consultationsService: ConsultationsService,
    private readonly localStorage: LocalStorageService,
    private readonly aiService: AiService,
    private readonly videoCallService: VideoCallService,
    private readonly voiceCallService: VoiceCallService,
  ) {}

  onModuleInit() {
    // Auto-fail / auto-complete scheduled sessions based on scheduled_end_time.
    this.autoEndTimer = setInterval(() => {
      void this.runAutoEndCycle();
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.autoEndTimer) {
      clearInterval(this.autoEndTimer);
      this.autoEndTimer = null;
    }
  }

  private getProvider(mode: ConsultationMode) {
    if (mode === ConsultationMode.VOICE) return this.voiceCallService;
    return this.videoCallService;
  }

  private runInBackground(taskName: string, job: () => Promise<void>, delayMs = 0) {
    setTimeout(() => {
      void job().catch((err) => {
        this.logger.error(`[background:${taskName}] ${err?.message || err}`);
      });
    }, delayMs);
  }

  private assertJoinWindow(session: {
    sessionType: SessionType;
    sessionStatus: SessionStatus;
    scheduledStartTime: Date;
    scheduledEndTime: Date | null;
  }) {
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      throw new ForbiddenException('Session sudah ditutup');
    }

    if (session.sessionType === SessionType.INSTANT) return;

    if (!session.scheduledEndTime) {
      throw new BadRequestException('scheduled_end_time wajib untuk SCHEDULED');
    }

    const now = Date.now();
    const startMs = session.scheduledStartTime.getTime();
    const endMs = session.scheduledEndTime.getTime();

    if (now < startMs || now >= endMs) {
      throw new ForbiddenException(
        'Belum masuk window join atau session sudah melewati end time',
      );
    }
  }

  private calculateDuration(startedAt: Date | null, endedAt: Date) {
    if (!startedAt) return { durationSec: 0, durationMinutes: 1 };
    const diffSec = Math.max(
      0,
      Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    );
    const diffMin = Math.max(1, Math.ceil(diffSec / 60));
    return { durationSec: diffSec, durationMinutes: diffMin };
  }

  private async ensureRoom(session: {
    consultationMode: ConsultationMode;
    roomName: string;
    sessionId: string;
  }) {
    const provider = this.getProvider(session.consultationMode);
    const room = await provider.ensureRoom(session.roomName, this.statusCallbackUrl);

    await this.prisma.consultationSession.update({
      where: { sessionId: session.sessionId },
      data: {
        twilioRoomSid: room.sid ?? undefined,
      },
    });

    return room;
  }

  private async runAutoEndCycle() {
    if (this.autoEndRunning) return;
    this.autoEndRunning = true;

    try {
      const now = new Date();
      const dueSessions = await this.prisma.consultationSession.findMany({
        where: {
          sessionType: 'SCHEDULED',
          sessionStatus: {
            in: ['CREATED', 'IN_CALL'],
          },
          scheduledEndTime: {
            not: null,
            lte: now,
          },
        },
        select: {
          sessionId: true,
          doctorId: true,
          doctorJoinedAt: true,
          patientJoinedAt: true,
        },
      });

      for (const session of dueSessions) {
        if (session.doctorJoinedAt && session.patientJoinedAt) {
          await this.completeSessionInternal(
            session.sessionId,
            session.doctorId,
            'AUTO_END_COMPLETED',
            true,
          );
        } else {
          await this.failSessionInternal(session.sessionId, 'AUTO_END_FAILED', true);
        }
      }
    } catch (error: any) {
      this.logger.error(`auto-end cycle failed: ${error?.message || error}`);
    } finally {
      this.autoEndRunning = false;
    }
  }

  private async completeSessionInternal(
    sessionId: string,
    doctorId: string,
    action: string,
    isSystem: boolean,
  ) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { sessionId },
      include: {
        doctor: true,
      },
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      return {
        success: true,
        sessionId,
        status: session.sessionStatus,
      };
    }

    const endedAt = new Date();

    if (session.twilioRoomSid) {
      try {
        await this.videoCallService.completeRoom(session.twilioRoomSid);
      } catch (error: any) {
        this.logger.warn(
          `complete room warning sessionId=${sessionId} message=${error?.message || error}`,
        );
      }
    }

    const baseStart = session.startedAt ?? session.doctorJoinedAt ?? endedAt;
    const { durationMinutes, durationSec } = this.calculateDuration(baseStart, endedAt);

    const updated = await this.prisma.consultationSession.update({
      where: { sessionId },
      data: {
        sessionStatus: 'COMPLETED',
        endedAt,
        durationMinutes,
        durationSec,
        ...(session.sessionType === 'INSTANT' && !session.scheduledEndTime
          ? {
              scheduledEndTime: endedAt,
            }
          : {}),
      },
    });

    await this.prisma.consultationNote.upsert({
      where: { consultationSessionId: updated.sessionId },
      update: {
        doctorId: session.doctorId,
        aiStatus: 'PENDING',
        aiError: null,
      },
      create: {
        consultationSessionId: updated.sessionId,
        doctorId: session.doctorId,
        patientId: session.patientId,
        aiStatus: 'PENDING',
        aiError: null,
      },
    });

    await this.consultationsService.createAudit({
      consultationSessionId: session.sessionId,
      action,
      actorUserId: isSystem ? null : doctorId,
      actorRole: isSystem ? null : UserRole.DOCTOR,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.COMPLETED,
      metadata: {
        durationMinutes,
        auto: isSystem,
      },
    });

    this.runInBackground(
      `ai-summary:${session.sessionId}`,
      async () => {
        await this.aiService.processConsultationFromTranscript(session.sessionId);
      },
      1500,
    );

    return {
      success: true,
      sessionId: session.sessionId,
      roomSid: session.twilioRoomSid,
      status: 'COMPLETED',
      aiStatus: 'PENDING',
    };
  }

  private async failSessionInternal(sessionId: string, action: string, isSystem: boolean) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { sessionId },
      select: {
        sessionId: true,
        sessionStatus: true,
        scheduledEndTime: true,
        twilioRoomSid: true,
      },
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      return;
    }

    if (session.twilioRoomSid) {
      try {
        await this.videoCallService.completeRoom(session.twilioRoomSid);
      } catch (error: any) {
        this.logger.warn(
          `complete room on fail warning sessionId=${sessionId} message=${error?.message || error}`,
        );
      }
    }

    await this.prisma.consultationSession.update({
      where: { sessionId },
      data: {
        sessionStatus: 'FAILED',
        endedAt: session.scheduledEndTime ?? new Date(),
        durationMinutes: null,
        durationSec: null,
      },
    });

    await this.consultationsService.createAudit({
      consultationSessionId: session.sessionId,
      action,
      actorUserId: null,
      actorRole: null,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.FAILED,
      metadata: {
        auto: isSystem,
      },
    });
  }

  async markSessionFailedBySystem(sessionId: string, action = 'AUTO_END_FAILED') {
    return this.failSessionInternal(sessionId, action, true);
  }

  async markSessionCompletedBySystem(
    sessionId: string,
    doctorId: string,
    action = 'AUTO_END_COMPLETED',
  ) {
    return this.completeSessionInternal(sessionId, doctorId, action, true);
  }

  async doctorToken(doctorId: string, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { sessionId },
      include: {
        doctor: {
          include: {
            doctorProfile: {
              select: {
                license: true,
              },
            },
          },
        },
      },
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');

    await this.consultationsService.createAudit({
      consultationSessionId: session.sessionId,
      action: 'DOCTOR_JOIN_ATTEMPT',
      actorUserId: doctorId,
      actorRole: UserRole.DOCTOR,
      previousStatus: session.sessionStatus,
      newStatus: session.sessionStatus,
      metadata: {
        consultationMode: session.consultationMode,
      },
    });

    if (session.doctorId !== doctorId) {
      await this.consultationsService.createAudit({
        consultationSessionId: session.sessionId,
        action: 'DOCTOR_JOIN_DENIED',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: session.sessionStatus,
        metadata: {
          reason: 'NOT_ASSIGNED_DOCTOR',
        },
      });
      throw new ForbiddenException('Bukan session dokter ini');
    }

    if (!session.doctor.doctorProfile?.license?.trim()) {
      await this.consultationsService.createAudit({
        consultationSessionId: session.sessionId,
        action: 'DOCTOR_JOIN_DENIED',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: session.sessionStatus,
        metadata: {
          reason: 'DOCTOR_LICENSE_EMPTY',
        },
      });
      throw new ForbiddenException('Dokter tanpa license tidak bisa join');
    }

    this.assertJoinWindow(session);

    if (session.doctorJoinedAt) {
      await this.consultationsService.createAudit({
        consultationSessionId: session.sessionId,
        action: 'DOCTOR_JOIN_DENIED',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: session.sessionStatus,
        metadata: {
          reason: 'DOCTOR_ALREADY_JOINED',
        },
      });
      throw new ForbiddenException('Dokter sudah join pada session ini');
    }

    const identity = session.doctor.twilioIdentity;
    if (!identity) {
      throw new BadRequestException('Twilio identity dokter belum tersedia');
    }

    await this.ensureRoom(session);

    const now = new Date();
    const startedAt = !session.startedAt && session.patientJoinedAt ? now : session.startedAt;

    await this.prisma.consultationSession.update({
      where: { sessionId: session.sessionId },
      data: {
        doctorIdentity: identity,
        doctorJoinedAt: now,
        sessionStatus: 'IN_CALL',
        startedAt: startedAt ?? undefined,
      },
    });

    await this.consultationsService.createAudit({
      consultationSessionId: session.sessionId,
      action: 'DOCTOR_JOIN_SUCCESS',
      actorUserId: doctorId,
      actorRole: UserRole.DOCTOR,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.IN_CALL,
      metadata: {
        consultationMode: session.consultationMode,
      },
    });

    const provider = this.getProvider(session.consultationMode);
    const token = provider.generateToken(identity, session.roomName);

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
    };
  }

  async patientToken(patientId: string, sessionId: string, _clientIp?: string | null) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { sessionId },
      include: {
        doctor: true,
        patient: {
          include: {
            patientProfile: true,
          },
        },
      },
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.patientId !== patientId) {
      throw new ForbiddenException('Bukan session patient ini');
    }

    this.assertJoinWindow(session);

    if (session.patientJoinedAt) {
      throw new ForbiddenException('Patient sudah join pada session ini');
    }

    await this.ensureRoom(session);

    const identity = `patient_${session.sessionId}_${patientId.slice(0, 8)}`.slice(0, 128);
    const patientName =
      session.patient.patientProfile?.fullName ??
      session.patient.name ??
      'Patient';

    const now = new Date();
    const startedAt = !session.startedAt && session.doctorJoinedAt ? now : session.startedAt;

    await this.prisma.consultationSession.update({
      where: { sessionId: session.sessionId },
      data: {
        patientIdentity: identity,
        patientName,
        patientJoinedAt: now,
        sessionStatus: 'IN_CALL',
        startedAt: startedAt ?? undefined,
      },
    });

    await this.consultationsService.createAudit({
      consultationSessionId: session.sessionId,
      action: 'PATIENT_JOIN_SUCCESS',
      actorUserId: patientId,
      actorRole: UserRole.PATIENT,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.IN_CALL,
      metadata: {
        consultationMode: session.consultationMode,
      },
    });

    const provider = this.getProvider(session.consultationMode);
    const token = provider.generateToken(identity, session.roomName);

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      doctorName: session.doctor.name ?? 'Doctor',
      patientName,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
    };
  }

  async completeConsultationRoom(sessionId: string, doctorId: string) {
    return this.completeSessionInternal(sessionId, doctorId, 'DOCTOR_END_CALL', false);
  }

  async getCallSessionResult(doctorId: string, sessionId: string) {
    const session = await this.prisma.consultationSession.findFirst({
      where: {
        sessionId,
        doctorId,
      },
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');

    let playableUrl: string | null = session.mediaUrl ?? null;
    if (!playableUrl && session.compositionSid) {
      playableUrl = await this.videoCallService.getCompositionMediaUrl(
        session.compositionSid,
        3600,
      );
    }

    return {
      sessionId: session.sessionId,
      sessionStatus: session.sessionStatus,
      consultationMode: session.consultationMode,
      consultationSession: session,
      playableUrl,
    };
  }

  async saveTranscription(doctorId: string, payload: VideoTranscriptionDto) {
    const sessionId = payload.sessionId?.trim();
    const transcription = payload.transcription?.trim();

    if (!sessionId) {
      throw new BadRequestException('sessionId wajib');
    }
    if (!transcription) {
      return { success: true, ignored: true };
    }

    const session = await this.prisma.consultationSession.findFirst({
      where: {
        sessionId,
        doctorId,
      },
      include: {
        consultationNote: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session tidak ditemukan');
    }

    const existing = session.consultationNote?.transcriptRaw ?? '';
    const currentStatus = String(session.consultationNote?.aiStatus ?? '').toUpperCase();
    const nextStatus =
      currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS'
        ? session.consultationNote?.aiStatus ?? null
        : 'TRANSCRIBING';
    const nextTranscript = existing ? `${existing}\n${transcription}` : transcription;

    await this.prisma.consultationNote.upsert({
      where: { consultationSessionId: sessionId },
      update: {
        doctorId,
        transcriptRaw: nextTranscript,
        transcribedAt: new Date(),
        ...(nextStatus ? { aiStatus: nextStatus, aiError: null } : {}),
      },
      create: {
        consultationSessionId: sessionId,
        doctorId,
        patientId: session.patientId,
        transcriptRaw: nextTranscript,
        transcribedAt: new Date(),
        aiStatus: nextStatus ?? 'TRANSCRIBING',
        aiError: null,
      },
    });

    return { success: true };
  }

  async tryCreateComposition(roomSid: string) {
    const session = await this.prisma.consultationSession.findFirst({
      where: {
        twilioRoomSid: roomSid,
      },
    });

    if (!session) return null;
    if (session.compositionSid) return null;

    const recordings = await this.videoCallService.listRecordingsByRoomSid(roomSid);
    if (!recordings.length) return null;

    const hasPending = recordings.some(
      (item: any) => !['completed', 'failed', 'deleted'].includes(item.status),
    );
    if (hasPending) return null;

    const completed = recordings.some((item: any) => item.status === 'completed');
    if (!completed) {
      return null;
    }

    const composition = await this.videoCallService.createComposition(
      roomSid,
      this.statusCallbackUrl,
    );

    await this.prisma.consultationSession.update({
      where: { sessionId: session.sessionId },
      data: {
        compositionSid: composition.sid,
        compositionStatus: composition.status ?? 'enqueued',
      },
    });

    return composition;
  }

  async getCompositionMediaUrl(compositionSid: string, ttl = 3600) {
    const url = await this.videoCallService.getCompositionMediaUrl(compositionSid, ttl);
    if (!url) {
      throw new NotFoundException('Composition media URL not found');
    }
    return url;
  }

  async downloadCompositionToLocal(compositionSid: string, sessionId: string) {
    const mediaUrl = await this.getCompositionMediaUrl(compositionSid, 3600);
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to download composition media: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = `session-${sessionId}-${randomUUID()}.mp4`;

    await this.localStorage.saveFromBuffer(filename, buffer);

    return {
      filename,
      publicUrl: this.localStorage.buildPublicUrl(filename),
    };
  }
}
