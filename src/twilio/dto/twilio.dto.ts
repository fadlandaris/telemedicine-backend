import { IsBoolean, IsNumber, IsOptional, IsString, Length } from "class-validator";

export class DoctorVideoTokenDto {
  @IsString()
  consultationId: string;
}

export class GuestVideoTokenDto {
  @IsString()
  linkToken: string;

  @IsString()
  @Length(1, 50)
  displayName: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  clientIp?: string;
}

export class VideoTranscriptionDto {
  @IsString()
  consultationId: string;

  @IsString()
  @Length(1, 10000)
  transcription: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  participant?: string;

  @IsOptional()
  @IsBoolean()
  partialResults?: boolean;

  @IsOptional()
  @IsNumber()
  stability?: number;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  languageCode?: string;

  @IsOptional()
  @IsNumber()
  sequenceNumber?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timestamp?: string;
}
