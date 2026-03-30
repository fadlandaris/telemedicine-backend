import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomBytes } from 'crypto';
import { CreateConsultationDto } from './dto/consultations.dto';
import { TwilioService } from '../twilio/twilio.service';

function base64Url(bytes: Buffer) {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

@Injectable()
export class ConsultationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TwilioService))
    private twilioService: TwilioService,
  ) {}

  private async generateUniqueRoomName(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = `room_${base64Url(randomBytes(12))}`;
      const exists = await this.prisma.consultation.findUnique({
        where: { roomName: candidate },
      });
      if (!exists) return candidate;
    }
    throw new Error('Failed to generate unique roomName');
  }

  async createForDoctor(doctorId: string, dto: CreateConsultationDto) {
    const linkToken = base64Url(randomBytes(24));
    const roomName = await this.generateUniqueRoomName();

    const expiresInMinutes = dto.expiresInMinutes ?? 60;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    return this.prisma.consultation.create({
      data: {
        doctorId,
        linkToken,
        roomName,
        status: 'CREATED',
        expiresAt,
      },
      select: {
        id: true,
        linkToken: true,
        roomName: true,
        status: true,
        expiresAt: true,
      },
    });
  }

  async getByLinkToken(linkToken: string) {
    const c = await this.prisma.consultation.findUnique({
      where: { linkToken },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            twilioIdentity: true,
          },
        },
        callSession: true,
      },
    });

    if (!c) throw new NotFoundException('Link tidak valid');

    if (c.expiresAt && c.expiresAt.getTime() < Date.now()) {
      if (c.status !== 'EXPIRED') {
        await this.prisma.consultation.update({
          where: { id: c.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new ForbiddenException('Link sudah expired');
    }

    return c;
  }

  async lockPatientIfNeeded(
  consultationId: string,
  patientIdentity: string,
  patientName: string,
) {
  const c = await this.prisma.consultation.findUnique({
    where: { id: consultationId },
  });

  if (!c) throw new NotFoundException();

  if (c.patientIdentity && c.patientIdentity !== patientIdentity) {
    throw new ForbiddenException('Link sudah dipakai pasien lain');
  }

  const shouldSetIdentity = !c.patientIdentity;
  const shouldSetName = !c.patientName;

  if (shouldSetIdentity || shouldSetName || c.status === 'CREATED') {
    await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        ...(shouldSetIdentity ? { patientIdentity } : {}),
        ...(shouldSetName ? { patientName } : {}),
        ...(c.status === 'CREATED' ? { status: 'WAITING' } : {}),
      },
    });
  }
}

  async endConsultation(doctorId: string, consultationId: string) {
    return this.twilioService.completeConsultationRoom(consultationId, doctorId);
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

    return {
      consultationId: consultation.id,
      consultationStatus: consultation.status,
      callSession: consultation.callSession,
      playableUrl: consultation.callSession.mediaUrl ?? null,
    };
  }

  async getConsultationNote(doctorId: string, consultationId: string) {
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

    return consultation.consultationNote;
  }
}
