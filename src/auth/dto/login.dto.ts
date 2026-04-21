import { IsString, MinLength, IsOptional, IsBoolean } from "class-validator";

// login (email atau phone)
export class LoginDto {
  @IsString()
  identifier: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
