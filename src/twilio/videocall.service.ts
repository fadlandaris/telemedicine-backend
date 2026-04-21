import { Injectable } from '@nestjs/common';
import twilio from 'twilio';

@Injectable()
export class VideoCallService {
  private readonly accountSid = process.env.TWILIO_ACCOUNT_SID!;
  private readonly apiKeySid = process.env.TWILIO_API_KEY_SID!;
  private readonly apiKeySecret = process.env.TWILIO_API_KEY_SECRET!;
  private readonly client: any;

  constructor() {
    this.client = twilio(this.apiKeySid, this.apiKeySecret, {
      accountSid: this.accountSid,
    });
  }

  getTwilioClient() {
    return this.client;
  }

  generateToken(identity: string, roomName: string, ttl = 60 * 60) {
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(
      this.accountSid,
      this.apiKeySid,
      this.apiKeySecret,
      {
        identity,
        ttl,
      },
    );

    token.addGrant(new VideoGrant({ room: roomName }));
    return token.toJwt();
  }

  async ensureRoom(roomName: string, statusCallbackUrl: string) {
    let room: any = null;
    try {
      room = await this.client.video.v1.rooms(roomName).fetch();
      if (room?.status === 'completed') {
        throw new Error('Twilio room already completed');
      }
      return room;
    } catch {
      room = await this.client.video.v1.rooms.create({
        uniqueName: roomName,
        type: 'group',
        maxParticipants: 2,
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: 'POST',
        recordParticipantsOnConnect: true,
        emptyRoomTimeout: 5,
        unusedRoomTimeout: 5,
      });
      return room;
    }
  }

  async completeRoom(roomSid: string) {
    return this.client.video.v1.rooms(roomSid).update({
      status: 'completed',
    });
  }

  async listRecordingsByRoomSid(roomSid: string) {
    return this.client.video.v1.rooms(roomSid).recordings.list({ limit: 100 });
  }

  async createComposition(roomSid: string, statusCallbackUrl: string) {
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
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: 'POST',
    });
  }

  async getCompositionMediaUrl(compositionSid: string, ttl = 3600) {
    const response = await this.client.request({
      method: 'GET',
      uri: `https://video.twilio.com/v1/Compositions/${compositionSid}/Media?Ttl=${ttl}`,
    });

    const body = response.body as { redirect_to?: string };
    return body?.redirect_to ?? null;
  }
}

