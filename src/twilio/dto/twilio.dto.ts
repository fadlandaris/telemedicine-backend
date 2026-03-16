import { IsString, Length } from "class-validator";

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
}
