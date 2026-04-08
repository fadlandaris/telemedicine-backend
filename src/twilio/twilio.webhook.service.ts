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

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        endedAt: callSession.endedAt ?? timestamp,
        durationSec: roomDuration ?? callSession.durationSec ?? undefined,
        recordingStatus: 'processing',
      },
    });

    if (callSession.consultation.status !== 'DONE') {
      this.runInBackground(
        `ai-summary:room-ended:${callSession.consultationId}`,
        async () => {
          await this.aiService.processConsultationFromTranscript(
            callSession.consultationId,
          );
        },
        2000,
      );
    }

    this.runInBackground(
      `tryCreateComposition:room-ended:${roomSid}`,
      async () => {
        await this.twilioService.tryCreateComposition(roomSid);
      },
      15000,
    );
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

    void this.twilioService.tryCreateComposition(roomSid).catch((err) => {
      this.logger.error(
        `tryCreateComposition failed on recording-completed roomSid=${roomSid} message=${err?.message || err}`,
      );
    });
  }

  private async onRecordingFailed(body: WebhookBody, _timestamp: Date) {
    const roomSid = body.RoomSid;
    const errorMessage = body.ErrorMessage || body.FailedOperation || 'recording failed';

    const callSession = await this.findCallSession(roomSid);
    if (!callSession) return;

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        status: 'FAILED',
        recordingStatus: 'failed',
        errorMessage,
      },
    });
  }

  private async onCompositionStarted(body: WebhookBody, timestamp: Date) {
    const compositionSid = body.CompositionSid;
    if (!compositionSid) return;

    const callSession = await this.prisma.callSession.findFirst({
      where: { compositionSid },
      include: {
        consultation: true,
      },
    });

    await this.prisma.callSession.updateMany({
      where: { compositionSid },
      data: {
        compositionStatus: 'started',
        compositionStartedAt: timestamp,
      },
    });

    if (!callSession) return;
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
      await this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          status: 'COMPLETED',
          compositionStatus: 'available',
          compositionReadyAt: timestamp,
          durationSec: duration ?? callSession.durationSec ?? undefined,
          errorMessage: null,
        },
      });

      this.runInBackground(
        `download-composition:${callSession.id}`,
        async () => {
          try {
            const saved = await this.twilioService.downloadCompositionToLocal(
              compositionSid,
              callSession.consultationId,
            );

            await this.prisma.callSession.update({
              where: { id: callSession.id },
              data: {
                mediaUrl: saved.publicUrl,
                mediaFormat: 'mp4',
                errorMessage: null,
              },
            });
          } catch (error: any) {
            this.logger.error(
              `Download composition failed consultationId=${callSession.consultationId} message=${error?.message || error}`,
            );

            await this.prisma.callSession.update({
              where: { id: callSession.id },
              data: {
                errorMessage: error?.message || String(error),
              },
            });
          }
        },
      30000,
    );
    } catch (error: any) {
      this.logger.error(
        `Failed on composition-available consultationId=${callSession.consultationId} message=${error?.message || error}`,
      );

      await this.prisma.callSession.update({
        where: { id: callSession.id },
        data: {
          status: 'FAILED',
          errorMessage: error?.message || String(error),
        },
      });
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

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        status: 'FAILED',
        compositionStatus: 'failed',
        errorMessage,
      },
    });
  }

  private runInBackground(
    taskName: string,
    job: () => Promise<void>,
    delayMs = 0,
  ) {
    setTimeout(() => {
      void job().catch((err) => {
        this.logger.error(`[background:${taskName}] ${err?.message || err}`);
      });
    }, delayMs);
  }
}
