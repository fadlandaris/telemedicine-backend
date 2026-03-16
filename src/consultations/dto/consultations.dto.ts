import { IsInt, IsOptional, Max, Min } from "class-validator";

export class CreateConsultationDto {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  expiresInMinutes?: number;
}
