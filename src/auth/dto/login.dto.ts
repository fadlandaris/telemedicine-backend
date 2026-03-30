import { IsEmail, IsString, MinLength } from "class-validator";

// login
export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
