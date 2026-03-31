import { IsOptional, IsString, Length } from "class-validator";

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
