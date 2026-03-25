import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { TwilioService } from './twilio.service';
import { AiService } from 'src/ai-summary/ai.service';

type WebhookBody = Record<string, any>;

@Injectable()
export class TwilioWebhookService {
  private readonly logger = new Logger(TwilioWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilioService: TwilioService,
    private readonly aiService: AiService,
  ) {}

  async handleVideoWebhook(body: WebhookBody) {
    const event = body.StatusCallbackEvent;
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    this.logger.log(`Twilio webhook event=${event} roomSid=${roomSid} roomName=${roomName}`);

    switch (event) {
      case 'room-created':
        return this.onRoomCreated(body);

      case 'participant-connected':
        return this.onParticipantConnected(body, timestamp);

      case 'participant-disconnected':
        return this.onParticipantDisconnected(body, timestamp);

      case 'room-ended':
        return this.onRoomEnded(body, timestamp);

      case 'recording-started':
        return this.onRecordingStarted(body, timestamp);

      case 'recording-completed':
        return this.onRecordingCompleted(body, timestamp);

      case 'recording-failed':
        return this.onRecordingFailed(body, timestamp);

      case 'composition-started':
        return this.onCompositionStarted(body, timestamp);

      case 'composition-available':
        return this.onCompositionAvailable(body, timestamp);

      case 'composition-failed':
        return this.onCompositionFailed(body, timestamp);

      default:
        this.logger.warn(`Unhandled event: ${event}`);
        return;
    }
  }

  private async findCallSession(roomSid?: string) {
    if (!roomSid) return null;

    return this.prisma.callSession.findFirst({
      where: { roomSid },
      include: {
        consultation: {
          include: {
            doctor: true,
          },
        },
      },
    });
  }

  private async onRoomCreated(body: WebhookBody) {
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;

    if (!roomSid || !roomName) return;

    await this.prisma.callSession.updateMany({
      where: { roomSid },
      data: { roomName },
    });
  }

  private async onParticipantConnected(body: WebhookBody, timestamp: Date) {
    const roomSid = body.RoomSid;
    const participantIdentity = body.ParticipantIdentity;

    const callSession = await this.findCallSession(roomSid);
    if (!callSession || !participantIdentity) return;

    const isDoctor =
      participantIdentity === callSession.doctorIdentity ||
      participantIdentity === callSession.consultation.doctor.twilioIdentity;

    await this.prisma.$transaction([
      this.prisma.consultation.update({
        where: { id: callSession.consultationId },
        data: {
          status: 'IN_CALL',
          startedAt: callSession.consultation.startedAt ?? timestamp,
          ...(isDoctor
            ? {}
            : {
                patientIdentity:
                  callSession.consultation.patientIdentity ?? participantIdentity,
                patientJoinedAt:
                  callSession.consultation.patientJoinedAt ?? timestamp,
              }),
        },
      }),
      this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          status: 'CONNECTED',
          startedAt: callSession.startedAt ?? timestamp,
          ...(isDoctor
            ? {}
            : {
                patientIdentity: callSession.patientIdentity ?? participantIdentity,
              }),
        },
      }),
    ]);
  }

  private async onParticipantDisconnected(body: WebhookBody, timestamp: Date) {
    const roomSid = body.RoomSid;
    const callSession = await this.findCallSession(roomSid);

    if (!callSession) return;

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        endedAt: callSession.endedAt ?? timestamp,
      },
    });
  }

  private async onRoomEnded(body: WebhookBody, timestamp: Date) {
    const roomSid = body.RoomSid;
    const roomDuration = body.RoomDuration ? Number(body.RoomDuration) : null;

    const callSession = await this.findCallSession(roomSid);
    if (!callSession || !roomSid) return;

    await this.prisma.$transaction([
      this.prisma.consultation.update({
        where: { id: callSession.consultationId },
        data: {
          status: 'PROCESSING',
          endedAt: callSession.consultation.endedAt ?? timestamp,
        },
      }),
      this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          endedAt: callSession.endedAt ?? timestamp,
          durationSec: roomDuration ?? callSession.durationSec ?? undefined,
          recordingStatus: 'processing',
        },
      }),
    ]);

    setTimeout(() => {
      this.twilioService
        .tryCreateComposition(roomSid)
        .catch((err) =>
          this.logger.error(`tryCreateComposition failed on room-ended`, err),
        );
    }, 15000);
  }

  private async onRecordingStarted(body: WebhookBody, timestamp: Date) {
    const roomSid = body.RoomSid;
    const callSession = await this.findCallSession(roomSid);

    if (!callSession) return;

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        recordingStatus: 'started',
        recordingStartedAt: callSession.recordingStartedAt ?? timestamp,
      },
    });
  }

  private async onRecordingCompleted(body: WebhookBody, timestamp: Date) {
    const roomSid = body.RoomSid;
    const callSession = await this.findCallSession(roomSid);

    if (!callSession || !roomSid) return;

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        recordingStatus: 'completed',
        recordingCompletedAt: timestamp,
      },
    });

    await this.twilioService.tryCreateComposition(roomSid);
  }

  private async onRecordingFailed(body: WebhookBody, _timestamp: Date) {
    const roomSid = body.RoomSid;
    const errorMessage = body.ErrorMessage || body.FailedOperation || 'recording failed';

    const callSession = await this.findCallSession(roomSid);
    if (!callSession) return;

    await this.prisma.$transaction([
      this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          status: 'FAILED',
          recordingStatus: 'failed',
          errorMessage,
        },
      }),
      this.prisma.consultation.update({
        where: { id: callSession.consultationId },
        data: {
          status: 'FAILED',
        },
      }),
    ]);
  }

  private async onCompositionStarted(body: WebhookBody, timestamp: Date) {
    const compositionSid = body.CompositionSid;
    if (!compositionSid) return;

    await this.prisma.callSession.updateMany({
      where: { compositionSid },
      data: {
        compositionStatus: 'started',
        compositionStartedAt: timestamp,
      },
    });
  }

  private async onCompositionAvailable(body: WebhookBody, timestamp: Date) {
    const compositionSid = body.CompositionSid;
    const duration = body.Duration ? Number(body.Duration) : null;

    if (!compositionSid) return;

    const callSession = await this.prisma.callSession.findFirst({
      where: { compositionSid },
      include: {
        consultation: true,
      },
    });

    if (!callSession) return;

    try {
      const saved = await this.twilioService.downloadCompositionToLocal(
        compositionSid,
        callSession.consultationId,
      );

      await this.prisma.$transaction([
        this.prisma.callSession.update({
          where: { id: callSession.id },
          data: {
            status: 'COMPLETED',
            compositionStatus: 'available',
            compositionReadyAt: timestamp,
            mediaUrl: saved.publicUrl,
            mediaFormat: 'mp4',
            durationSec: duration ?? callSession.durationSec ?? undefined,
            errorMessage: null,
          },
        }),
        this.prisma.consultationNote.upsert({
          where: { consultationId: callSession.consultationId },
          update: {
            doctorId: callSession.doctorId ?? callSession.consultation.doctorId,
            aiStatus: 'PENDING',
            aiError: null,
          },
          create: {
            consultationId: callSession.consultationId,
            doctorId: callSession.doctorId ?? callSession.consultation.doctorId,
            aiStatus: 'PENDING',
          },
        }),
      ]);

      void this.aiService
        .processConsultationFromCallSession(callSession.consultationId)
        .catch((err) => {
          this.logger.error(
            `Async AI process failed consultationId=${callSession.consultationId} message=${err?.message || err}`,
          );
        });
    } catch (error: any) {
      this.logger.error(
        `Failed on composition-available consultationId=${callSession.consultationId} message=${error?.message || error}`,
      );

      await this.prisma.$transaction([
        this.prisma.callSession.update({
          where: { id: callSession.id },
          data: {
            status: 'FAILED',
            errorMessage: error?.message || String(error),
          },
        }),
        this.prisma.consultation.update({
          where: { id: callSession.consultationId },
          data: {
            status: 'FAILED',
          },
        }),
      ]);
    }
  }

  private async onCompositionFailed(body: WebhookBody, _timestamp: Date) {
    const compositionSid = body.CompositionSid;
    const errorMessage = body.ErrorMessage || 'composition failed';

    if (!compositionSid) return;

   const callSession = await this.prisma.callSession.findFirst({
      where: { compositionSid },
      include: {
        consultation: true,
      },
    });

    if (!callSession) return;

    await this.prisma.$transaction([
      this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          status: 'FAILED',
          compositionStatus: 'failed',
          errorMessage,
        },
      }),
      this.prisma.consultation.update({
        where: { id: callSession.consultationId },
        data: {
          status: 'FAILED',
        },
      }),
    ]);
  }
}