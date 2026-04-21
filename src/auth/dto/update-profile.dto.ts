import { IsString, IsOptional, MinLength, IsDateString } from "class-validator";

export class UpdateDoctorProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdatePatientProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  bornDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export type UpdateProfileDto =
  | UpdateDoctorProfileDto
  | UpdateAdminProfileDto
  | UpdatePatientProfileDto;
