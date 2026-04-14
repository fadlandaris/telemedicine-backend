import { IsString, MinLength } from "class-validator";

// login (email atau phone)
export class LoginDto {
  @IsString()
  identifier: string;

  @IsString()
  @MinLength(8)
  password: string;
}
