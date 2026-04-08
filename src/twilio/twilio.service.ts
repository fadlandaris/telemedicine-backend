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
import { VideoTranscriptionDto } from './dto/twilio.dto';
import { AiService } from 'src/ai-summary/ai.service';

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
    private aiService: AiService,
  ) {
    this.client = twilio(this.apiKeySid, this.apiKeySecret, {
      accountSid: this.accountSid,
    });
  }

  private runInBackground(taskName: string, job: () => Promise<void>, delayMs = 0) {
    setTimeout(() => {
      void job().catch((err) => {
        this.logger.error(`[background:${taskName}] ${err?.message || err}`);
      });
    }, delayMs);
  }

  private normalizeClientIp(ip?: string | null): string | null {
    if (!ip || typeof ip !== 'string') return null;

    let value = ip.trim();
    if (!value) return null;

    if (value.startsWith('::ffff:')) {
      value = value.slice(7);
    }

    if (value.includes('.') && value.includes(':')) {
      value = value.split(':')[0];
    }

    if (this.isPrivateIp(value)) return null;

    return value;
  }

  private isPrivateIp(ip: string): boolean {
    if (!ip) return true;

    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fd') || ip.startsWith('fc')) {
      return true;
    }

    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;

    return false;
  }

  private hasPatientLocation(c: any): boolean {
    return !!(
      c?.patientCity ||
      c?.patientProvince ||
      c?.patientCountry ||
      c?.patientCountryCode
    );
  }

  private async resolveLocationFromIp(ip: string): Promise<{
    city?: string | null;
    region?: string | null;
    country?: string | null;
    countryCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null> {
    if (typeof fetch !== 'function') return null;

    try {
      const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
        headers: {
          'User-Agent': 'telemedicine-app',
        },
      });

      if (!response.ok) return null;

      const data: any = await response.json();
      if (!data || data.error) return null;

      const latitudeRaw = (data as any).latitude;
      const longitudeRaw = (data as any).longitude;
      const latitude =
        typeof latitudeRaw === 'number'
          ? latitudeRaw
          : Number.parseFloat(String(latitudeRaw));
      const longitude =
        typeof longitudeRaw === 'number'
          ? longitudeRaw
          : Number.parseFloat(String(longitudeRaw));

      return {
        city: typeof data.city === 'string' ? data.city : null,
        region: typeof data.region === 'string' ? data.region : null,
        country: typeof data.country_name === 'string' ? data.country_name : null,
        countryCode: typeof data.country_code === 'string' ? data.country_code : null,
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
      };
    } catch (error: any) {
      this.logger.warn(`ip lookup failed ip=${ip} message=${error?.message || String(error)}`);
      return null;
    }
  }

  private async tryUpdatePatientLocation(
    consultationId: string,
    clientIp?: string | null,
  ) {
    const ip = this.normalizeClientIp(clientIp);
    if (!ip) return;

    const location = await this.resolveLocationFromIp(ip);
    if (!location) return;

    await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        ...(location.countryCode ? { patientCountryCode: location.countryCode } : {}),
        ...(location.country ? { patientCountry: location.country } : {}),
        ...(location.region ? { patientProvince: location.region } : {}),
        ...(location.city ? { patientCity: location.city } : {}),
        ...(typeof location.latitude === 'number'
          ? { patientLatitude: location.latitude }
          : {}),
        ...(typeof location.longitude === 'number'
          ? { patientLongitude: location.longitude }
          : {}),
      },
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

  async guestToken(linkToken: string, displayName: string, clientIp?: string | null) {
    const c = await this.consultations.getByLinkToken(linkToken);

    this.assertJoinable(c);

    const digest = createHash('sha256').update(linkToken).digest('hex').slice(0, 12);
    const identity = `patient_${c.id}_${digest}`.slice(0, 128);
    const normalizedName = displayName.trim().slice(0, 50);
    const patientName = normalizedName;

    await this.consultations.lockPatientIfNeeded(c.id, identity, patientName);

    if (!this.hasPatientLocation(c)) {
      await this.tryUpdatePatientLocation(c.id, clientIp);
    }

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

      this.runInBackground(
        `ai-summary:${consultation.id}`,
        async () => {
          await this.aiService.processConsultationFromTranscript(consultation.id);
        },
        2000,
      );

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

  async saveTranscription(doctorId: string, payload: VideoTranscriptionDto) {
    const consultationId = payload.consultationId?.trim();
    const transcription = payload.transcription?.trim();

    if (!consultationId) {
      throw new BadRequestException('consultationId wajib');
    }

    if (!transcription) {
      return { success: true, ignored: true };
    }

    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        doctorId,
      },
      include: {
        consultationNote: true,
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation tidak ditemukan');
    }

    const existing = consultation.consultationNote?.transcriptRaw ?? '';
    const currentStatus = String(consultation.consultationNote?.aiStatus ?? '').toUpperCase();
    const nextStatus =
      currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS'
        ? consultation.consultationNote?.aiStatus ?? null
        : 'TRANSCRIBING';
    const nextTranscript = existing ? `${existing}\n${transcription}` : transcription;

    await this.prisma.consultationNote.upsert({
      where: { consultationId },
      update: {
        doctorId,
        transcriptRaw: nextTranscript,
        transcribedAt: new Date(),
        ...(nextStatus ? { aiStatus: nextStatus, aiError: null } : {}),
      },
      create: {
        consultationId,
        doctorId,
        transcriptRaw: nextTranscript,
        transcribedAt: new Date(),
        aiStatus: nextStatus ?? 'TRANSCRIBING',
        aiError: null,
      },
    });

    return { success: true };
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

