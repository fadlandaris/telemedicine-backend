import { Injectable } from '@nestjs/common';
import { VideoCallService } from './videocall.service';

@Injectable()
export class VoiceCallService {
  constructor(private readonly videoCallService: VideoCallService) {}

  // Current implementation keeps voice mode in the same Twilio room flow
  // and lets client connect in audio-first behavior.
  generateToken(identity: string, roomName: string, ttl = 60 * 60) {
    return this.videoCallService.generateToken(identity, roomName, ttl);
  }

  async ensureRoom(roomName: string, statusCallbackUrl: string) {
    return this.videoCallService.ensureRoom(roomName, statusCallbackUrl);
  }
}

