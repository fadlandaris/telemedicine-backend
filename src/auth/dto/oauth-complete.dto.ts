import { IsOptional, IsString } from "class-validator";

export class OAuthCompleteDto {
  @IsString()
  token: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bornDate?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  license?: string;

  @IsOptional()
  @IsString()
  adminId?: string;
}
