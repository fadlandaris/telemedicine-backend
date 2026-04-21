import { IsString, IsEmail, MinLength } from "class-validator";

export class ChangeEmailRequestDto {
  @IsEmail()
  newEmail: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class ConfirmEmailChangeDto {
  @IsEmail()
  newEmail: string;

  @IsString()
  code: string;
}

export class ForgotPasswordRequestDto {
  // Empty - use the authenticated user's email from JWT
}

export class SetNewPasswordDto {
  @IsString()
  code: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class UploadProfilePictureDto {
  // Handled by multer, no class validation needed
}
