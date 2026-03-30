import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import twilio from 'twilio';
import { PrismaService } from 'prisma/prisma.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { createHash } from 'crypto';
import { LocalStorageService } from 'src/video/local-storage.service';
import { randomUUID } from 'crypto';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: any;

  private accountSid = process.env.TWILIO_ACCOUNT_SID!;
  private apiKeySid = process.env.TWILIO_API_KEY_SID!;
  private apiKeySecret = process.env.TWILIO_API_KEY_SECRET!;
  private statusCallbackUrl =
    process.env.TWILIO_VIDEO_STATUS_CALLBACK_URL ||
    `${process.env.APP_BASE_URL}/twilio/webhooks/video-room`;

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ConsultationsService))
    private consultations: ConsultationsService,
    private localStorage: LocalStorageService,
  ) {
    this.client = twilio(this.apiKeySid, this.apiKeySecret, {
      accountSid: this.accountSid,
    });
  }

  private generateVideoJwt(identity: string, roomName: string) {
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(
      this.accountSid,
      this.apiKeySid,
      this.apiKeySecret,
      {
        identity,
        ttl: 60 * 60,
      },
    );

    token.addGrant(new VideoGrant({ room: roomName }));
    return token.toJwt();
  }

  private assertJoinable(c: any) {
    if (c.expiresAt && c.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Consultation expired');
    }

    if (['DONE', 'FAILED', 'EXPIRED'].includes(c.status)) {
      throw new ForbiddenException('Consultation not joinable');
    }

    if (c.status === 'PROCESSING') {
      throw new ForbiddenException('Consultation already ended');
    }
  }

  private upsertCallSession(params: {
    consultationId: string;
    doctorId?: string | null;
    roomSid?: string | null;
    roomName: string;
    doctorIdentity?: string | null;
    patientIdentity?: string | null;
    patientName?: string | null;
    recordingEnabled?: boolean;
  }) {
    return this.prisma.callSession.upsert({
      where: { consultationId: params.consultationId },
      update: {
        doctorId: params.doctorId ?? undefined,
        roomSid: params.roomSid ?? undefined,
        roomName: params.roomName,
        doctorIdentity: params.doctorIdentity ?? undefined,
        patientIdentity: params.patientIdentity ?? undefined,
        patientName: params.patientName ?? undefined,
        recordingEnabled: params.recordingEnabled ?? true,
      },
      create: {
        consultationId: params.consultationId,
        doctorId: params.doctorId ?? undefined,
        roomSid: params.roomSid ?? undefined,
        roomName: params.roomName,
        doctorIdentity: params.doctorIdentity ?? undefined,
        patientIdentity: params.patientIdentity ?? undefined,
        patientName: params.patientName ?? undefined,
        recordingEnabled: params.recordingEnabled ?? true,
        status: 'STARTED',
      },
    });
  }

  private async ensureRoomAndPersistSid(consultationId: string, roomName: string) {
    let room: any = null;

    try {
      room = await this.client.video.v1.rooms(roomName).fetch();

      if (room?.status === 'completed') {
        throw new BadRequestException('Room already completed');
      }
    } catch (error: any) {
      if (error?.status === 404 || error?.code === 20404 || !room) {
        room = await this.client.video.v1.rooms.create({
          uniqueName: roomName,
          type: 'group',
          maxParticipants: 2,
          statusCallback: this.statusCallbackUrl,
          statusCallbackMethod: 'POST',
          recordParticipantsOnConnect: true,
          emptyRoomTimeout: 5,
          unusedRoomTimeout: 5,
        });
      } else {
        throw error;
      }
    }

    await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        twilioRoomSid: room.sid ?? undefined,
      },
    });

    return room;
  }

  async doctorToken(doctorId: string, consultationId: string) {
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: true,
        callSession: true,
      },
    });

    if (!c) throw new NotFoundException('Consultation tidak ditemukan');
    if (c.doctorId !== doctorId) throw new ForbiddenException('Bukan milik dokter ini');

    this.assertJoinable(c);

    const room = await this.ensureRoomAndPersistSid(c.id, c.roomName);

    const identity = c.doctor.twilioIdentity;
    const token = this.generateVideoJwt(identity, c.roomName);

    await this.prisma.$transaction([
      this.prisma.consultation.update({
        where: { id: c.id },
        data: {
          status: c.status === 'CREATED' ? 'WAITING' : c.status,
          twilioRoomSid: room.sid,
        },
      }),
      this.upsertCallSession({
        consultationId: c.id,
        doctorId: c.doctorId,
        roomSid: room.sid,
        roomName: c.roomName,
        doctorIdentity: identity,
        patientIdentity: c.patientIdentity,
        patientName: c.patientName,
        recordingEnabled: true,
      }),
    ]);

    return {
      token,
      roomName: c.roomName,
      identity,
      consultationId: c.id,
    };
  }

  async guestToken(linkToken: string, displayName: string) {
    const c = await this.consultations.getByLinkToken(linkToken);

    this.assertJoinable(c);

    const digest = createHash('sha256').update(linkToken).digest('hex').slice(0, 12);
    const identity = `patient_${c.id}_${digest}`.slice(0, 128);
    const normalizedName = displayName.trim().slice(0, 50);
    const patientName = normalizedName;

    await this.consultations.lockPatientIfNeeded(c.id, identity, patientName);

    if (patientName && patientName !== c.patientName) {
      await this.prisma.consultation.update({
        where: { id: c.id },
        data: { patientName },
      });
    }

    const room = await this.ensureRoomAndPersistSid(c.id, c.roomName);
    const token = this.generateVideoJwt(identity, c.roomName);

    await this.upsertCallSession({
      consultationId: c.id,
      doctorId: c.doctorId,
      roomSid: room.sid,
      roomName: c.roomName,
      doctorIdentity: c.doctor.twilioIdentity ?? undefined,
      patientIdentity: identity,
      patientName,
      recordingEnabled: true,
    }); 

    return {
      token,
      roomName: c.roomName,
      identity,
      consultationId: c.id,
      doctorName: c.doctor.name ?? 'Doctor',
      displayName: normalizedName,
    };
  }

  async completeConsultationRoom(consultationId: string, doctorId: string) {
      const consultation = await this.prisma.consultation.findUnique({
        where: { id: consultationId },
        include: {
          doctor: true,
          callSession: true,
        },
      });

      if (!consultation) {
        throw new NotFoundException('Consultation tidak ditemukan');
      }

      if (consultation.doctorId !== doctorId) {
        throw new ForbiddenException('Bukan milik dokter ini');
      }

      if (!consultation.twilioRoomSid) {
        throw new BadRequestException('Twilio room SID belum ada');
      }

      if (['DONE', 'FAILED', 'EXPIRED'].includes(consultation.status)) {
        throw new BadRequestException('Consultation sudah selesai');
      }

      try {
        await this.client.video.v1.rooms(consultation.twilioRoomSid).update({
          status: 'completed',
        });
      } catch (error: any) {
        this.logger.warn(
          `complete room warning consultationId=${consultationId} message=${error?.message}`,
        );
      }

      await this.prisma.$transaction([
        this.prisma.consultation.update({
          where: { id: consultation.id },
          data: {
            status: 'DONE',
            endedAt: consultation.endedAt ?? new Date(),
          },
        }),
        this.prisma.callSession.updateMany({
          where: { consultationId: consultation.id },
          data: {
            endedAt: new Date(),
          },
        }),
        this.prisma.consultationNote.upsert({
          where: { consultationId: consultation.id },
          update: {
            doctorId: consultation.doctorId,
            aiStatus: 'PENDING',
            aiError: null,
          },
          create: {
            consultationId: consultation.id,
            doctorId: consultation.doctorId,
            aiStatus: 'PENDING',
            aiError: null,
          },
        }),
      ]);

      return {
        success: true,
        consultationId: consultation.id,
        roomSid: consultation.twilioRoomSid,
        status: 'DONE',
        aiStatus: 'PENDING',
      };
  }

  async listRecordingsByRoomSid(roomSid: string) {
    return this.client.video.v1.rooms(roomSid).recordings.list({ limit: 100 });
  }

  async createComposition(roomSid: string) {
    return this.client.video.v1.compositions.create({
      roomSid,
      audioSources: ['*'],
      format: 'mp4',
      resolution: '1280x720',
      videoLayout: {
        grid: {
          video_sources: ['*'],
        },
      },
      statusCallback: this.statusCallbackUrl,
      statusCallbackMethod: 'POST',
    });
  }

  async tryCreateComposition(roomSid: string) {
    const callSession = await this.prisma.callSession.findFirst({
      where: { roomSid },
      include: { consultation: true },
    });

    if (!callSession) {
      this.logger.warn(`CallSession not found for roomSid=${roomSid}`);
      return null;
    }

    if (callSession.compositionSid) {
      this.logger.log(`Composition already exists for roomSid=${roomSid}`);
      return null;
    }

    const recordings = await this.listRecordingsByRoomSid(roomSid);

    if (!recordings.length) {
      this.logger.warn(`No recordings found for roomSid=${roomSid}`);
      return null;
    }

    const hasPending = recordings.some(
      (recording: any) =>
        !['completed', 'failed', 'deleted'].includes(recording.status),
    );

    if (hasPending) {
      this.logger.log(`Recordings still processing for roomSid=${roomSid}`);
      return null;
    }

    const completedRecordings = recordings.filter(
      (recording: any) => recording.status === 'completed',
    );

    if (!completedRecordings.length) {
      await this.prisma.$transaction([
        this.prisma.callSession.update({
          where: { id: callSession.id },
          data: {
            status: 'FAILED',
            recordingStatus: 'failed',
            errorMessage: 'No completed recordings found',
          },
        }),
        this.prisma.consultation.update({
          where: { id: callSession.consultationId },
          data: {
            status: 'FAILED',
          },
        }),
      ]);

      return null;
    }

    const composition = await this.createComposition(roomSid);

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        compositionSid: composition.sid,
        compositionStatus: composition.status ?? 'enqueued',
      },
    });

    return composition;
  }

  async getCompositionMediaUrl(compositionSid: string, ttl = 3600) {
    const response = await this.client.request({
      method: 'GET',
      uri: `https://video.twilio.com/v1/Compositions/${compositionSid}/Media?Ttl=${ttl}`,
    });

    const body = response.body as { redirect_to?: string };

    if (!body?.redirect_to) {
      throw new NotFoundException('Composition media URL not found');
    }

    return body.redirect_to;
  }

  async getCallSessionResult(doctorId: string, consultationId: string) {
  const consultation = await this.prisma.consultation.findFirst({
    where: {
      id: consultationId,
      doctorId,
    },
    include: {
      callSession: true,
    },
  });

  if (!consultation) {
    throw new NotFoundException('Consultation tidak ditemukan');
  }

  if (!consultation.callSession) {
    throw new NotFoundException('Call session belum ada');
  }

  let playableUrl: string | null = null;

  if (consultation.callSession.compositionSid) {
    try {
      playableUrl = await this.getCompositionMediaUrl(
        consultation.callSession.compositionSid,
        3600,
      );
    } catch {
      playableUrl = null;
    }
  }

  return {
    consultationId: consultation.id,
    consultationStatus: consultation.status,
    callSession: consultation.callSession,
    playableUrl,
  };
}

async downloadCompositionToLocal(compositionSid: string, consultationId: string) {
  const mediaUrl = await this.getCompositionMediaUrl(compositionSid, 3600);

  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download composition media: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filename = `consultation-${consultationId}-${randomUUID()}.mp4`;

  await this.localStorage.saveFromBuffer(filename, buffer);

  return {
    filename,
    publicUrl: this.localStorage.buildPublicUrl(filename),
  };
}
}

