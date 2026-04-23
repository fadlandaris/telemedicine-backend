import {
  Body,
  Controller,
  Put,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { join, extname } from "path";
import { existsSync, mkdirSync } from "fs";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { JwtPayload } from "../auth/types/jwt-payload";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthService } from "../auth/auth.service";
import {
  UpdateDoctorProfileDto,
  UpdateAdminProfileDto,
  UpdatePatientProfileDto,
} from "../auth/dto/update-profile.dto";
import {
  ChangeEmailRequestDto,
  ConfirmEmailChangeDto,
  ForgotPasswordRequestDto,
  SetNewPasswordDto,
} from "../auth/dto/profile-management.dto";

const uploadsDir = join(process.cwd(), "uploads", "profiles");
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

const pictureStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || "." + file.mimetype.split("/")[1];
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/svg+xml", "image/avif"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

@Controller("profile")
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(private auth: AuthService) {}

  // ==================== GET PROFILE ====================
  @Get("doctor")
  async getDoctorProfile(@CurrentUser() user: JwtPayload) {
    return this.auth.getDoctorProfile(user.sub);
  }

  @Get("admin")
  async getAdminProfile(@CurrentUser() user: JwtPayload) {
    return this.auth.getAdminProfile(user.sub);
  }

  @Get("patient")
  async getPatientProfile(@CurrentUser() user: JwtPayload) {
    return this.auth.getPatientProfile(user.sub);
  }

  // ==================== UPDATE PROFILE ====================
  @Put("doctor")
  async updateDoctorProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDoctorProfileDto,
  ) {
    return this.auth.updateDoctorProfile(user.sub, dto);
  }

  @Put("admin")
  async updateAdminProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAdminProfileDto,
  ) {
    return this.auth.updateAdminProfile(user.sub, dto);
  }

  @Put("patient")
  async updatePatientProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePatientProfileDto,
  ) {
    return this.auth.updatePatientProfile(user.sub, dto);
  }

  // ==================== EMAIL CHANGE FLOW ====================
  @Post("doctor/change-email")
  async requestEmailChangeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
  ) {
    return this.auth.requestEmailChange(user.sub, dto);
  }

  @Post("admin/change-email")
  async requestEmailChangeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
  ) {
    return this.auth.requestEmailChange(user.sub, dto);
  }

  @Post("patient/change-email")
  async requestEmailChangePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
  ) {
    return this.auth.requestEmailChange(user.sub, dto);
  }

  @Post("doctor/confirm-email-change")
  async confirmEmailChangeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto);
  }

  @Post("admin/confirm-email-change")
  async confirmEmailChangeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto);
  }

  @Post("patient/confirm-email-change")
  async confirmEmailChangePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto);
  }

  // ==================== PASSWORD RESET FLOW ====================
  @Post("doctor/forgot-password")
  async requestPasswordResetDoctor(@CurrentUser() user: JwtPayload) {
    return this.auth.requestPasswordReset(user.sub);
  }

  @Post("admin/forgot-password")
  async requestPasswordResetAdmin(@CurrentUser() user: JwtPayload) {
    return this.auth.requestPasswordReset(user.sub);
  }

  @Post("patient/forgot-password")
  async requestPasswordResetPatient(@CurrentUser() user: JwtPayload) {
    return this.auth.requestPasswordReset(user.sub);
  }

  @Post("doctor/verify-reset-code")
  async verifyResetCodeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code);
  }

  @Post("admin/verify-reset-code")
  async verifyResetCodeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code);
  }

  @Post("patient/verify-reset-code")
  async verifyResetCodePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code);
  }

  @Post("doctor/set-new-password")
  async setNewPasswordDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
  ) {
    return this.auth.setNewPassword(user.sub, dto);
  }

  @Post("admin/set-new-password")
  async setNewPasswordAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
  ) {
    return this.auth.setNewPassword(user.sub, dto);
  }

  @Post("patient/set-new-password")
  async setNewPasswordPatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
  ) {
    return this.auth.setNewPassword(user.sub, dto);
  }

  // ==================== PROFILE PICTURE UPLOAD ====================
  @Post("doctor/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  async uploadPictureDoctor(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: any,
  ) {
    return this.uploadProfilePicture(user.sub, file);
  }

  @Post("admin/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  async uploadPictureAdmin(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: any,
  ) {
    return this.uploadProfilePicture(user.sub, file);
  }

  @Post("patient/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  async uploadPicturePatient(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: any,
  ) {
    return this.uploadProfilePicture(user.sub, file);
  }

  private async uploadProfilePicture(
    userId: string,
    file: any,
  ) {
    if (!file) {
      throw new BadRequestException("File harus disertakan");
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        "Format file hanya boleh JPG, JPEG, PNG, SVG, atau AVIF",
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException("Ukuran file maksimal 2MB");
    }

    // Store relative path so ServeStaticModule can serve it at /uploads/profiles/<filename>
    const relativePath = `uploads/profiles/${file.filename}`;
    return this.auth.uploadProfilePicture(userId, relativePath);
  }
}
