import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import crypto from "crypto";
import { AuthAction, OAuthProvider, UserRole } from "@prisma/client";
import type { DoctorProfile, PatientProfile, AdminProfile, User } from "@prisma/client";
import type { JwtPayload } from "./types/jwt-payload";
import type { StringValue } from "ms";
import bcrypt from "bcryptjs";

function sha256(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseTtlToMs(ttl: string): number {
  // support: 15m, 30d, 1h, 10s
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000; // d
  return n * mult;
}

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const VERIFY_TTL_MINUTES = 30;
const OAUTH_STATE_TTL_MINUTES = 10;

function randomVerificationCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function ensurePhoneDigits(raw: string, normalized: string) {
  if (!normalized) throw new BadRequestException("Nomor telepon wajib diisi");
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException("Nomor telepon harus angka");
  }
}

function ensurePasswordPolicy(password: string) {
  if (!PASSWORD_REGEX.test(password)) {
    throw new BadRequestException(
      "Password minimal 8 karakter, harus ada 1 lowercase, 1 uppercase, dan 1 number",
    );
  }
}

function parseBornDate(raw?: string) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException("Tanggal lahir tidak valid");
  }
  return d;
}

function ensureMinimumAge(bornDate: Date, minYears: number) {
  const now = new Date();
  const cutoff = new Date(
    now.getFullYear() - minYears,
    now.getMonth(),
    now.getDate(),
  );
  if (bornDate > cutoff) {
    throw new BadRequestException(`Minimal umur ${minYears} tahun`);
  }
}

type ProfileWithUser =
  | (DoctorProfile & { user: User })
  | (AdminProfile & { user: User })
  | (PatientProfile & { user: User });

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private accessTtl = process.env.JWT_ACCESS_TTL || "15m";
  private refreshTtl = process.env.JWT_REFRESH_TTL || "30d";

  private frontendBaseUrl = process.env.APP_PUBLIC_BASE_URL || "http://localhost:3000";
  private backendBaseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

  private async audit(params: {
    userId?: string;
    email?: string;
    action: AuthAction;
    success: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    await this.prisma.authAuditLog.create({
      data: {
        userId: params.userId,
        email: params.email,
        action: params.action,
        success: params.success,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  }

  private async hashPassword(raw: string) {
    return bcrypt.hash(raw, 10);
  }

  private async verifyPassword(raw: string, passwordHash: string) {
    return bcrypt.compare(raw, passwordHash);
  }

  private parseRole(raw: string): UserRole {
    const value = String(raw || "").trim().toUpperCase();
    if (value === "DOCTOR") return UserRole.DOCTOR;
    if (value === "ADMIN") return UserRole.ADMIN;
    if (value === "PATIENT") return UserRole.PATIENT;
    throw new BadRequestException("Role tidak valid");
  }

  private parseProvider(raw: string): OAuthProvider {
    const value = String(raw || "").trim().toUpperCase();
    if (value === "GOOGLE") return OAuthProvider.GOOGLE;
    if (value === "MICROSOFT") return OAuthProvider.MICROSOFT;
    throw new BadRequestException("Provider OAuth tidak valid");
  }

  private async findProfileByIdentifier(lookup: { email?: string; phone?: string }) {
    const [doctor, admin, patient] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findFirst({
        where: lookup,
        include: { user: true },
      }),
      this.prisma.adminProfile.findFirst({
        where: lookup,
        include: { user: true },
      }),
      this.prisma.patientProfile.findFirst({
        where: lookup,
        include: { user: true },
      }),
    ]);

    const matches = [doctor, admin, patient].filter(Boolean) as ProfileWithUser[];
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new BadRequestException("Data email/telepon duplikat di profile");
    }
    return matches[0];
  }

  private async getProfileByUserId(userId: string, role: UserRole) {
    if (role === UserRole.DOCTOR) {
      return this.prisma.doctorProfile.findUnique({ where: { userId } });
    }
    if (role === UserRole.ADMIN) {
      return this.prisma.adminProfile.findUnique({ where: { userId } });
    }
    return this.prisma.patientProfile.findUnique({ where: { userId } });
  }

  private async ensureEmailPhoneAvailable(
    email: string,
    phone: string,
    options?: { excludePendingId?: string },
  ) {
    const [doctor, admin, patient] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: { id: true },
      }),
      this.prisma.adminProfile.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: { id: true },
      }),
      this.prisma.patientProfile.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: { id: true },
      }),
    ]);

    if (doctor || admin || patient) {
      throw new BadRequestException("Email atau nomor telepon sudah terdaftar");
    }

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        OR: [{ email }, { phone }],
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId
          ? { id: { not: options.excludePendingId } }
          : {}),
      },
      select: { id: true },
    });
    if (pending) {
      throw new BadRequestException("Email atau nomor telepon sudah terdaftar");
    }
  }

  private async ensureLicenseValid(license: string, options?: { excludePendingId?: string }) {
    const exists = await this.prisma.licenseWhitelist.findUnique({
      where: { license },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException("License tidak terdaftar");

    const used = await this.prisma.doctorProfile.findUnique({
      where: { license },
      select: { id: true },
    });
    if (used) throw new BadRequestException("License sudah digunakan");

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        license,
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId
          ? { id: { not: options.excludePendingId } }
          : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("License sedang digunakan");
  }

  private async ensureAdminIdValid(adminId: string, options?: { excludePendingId?: string }) {
    const exists = await this.prisma.adminIdWhitelist.findUnique({
      where: { adminId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException("Admin ID tidak terdaftar");

    const used = await this.prisma.adminProfile.findUnique({
      where: { adminId },
      select: { id: true },
    });
    if (used) throw new BadRequestException("Admin ID sudah digunakan");

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        adminId,
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId
          ? { id: { not: options.excludePendingId } }
          : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("Admin ID sedang digunakan");
  }

  private async purgeExpiredPendingRegistrations() {
    await this.prisma.pendingRegistration.deleteMany({
      where: {
        expiresAt: { lte: new Date() },
      },
    });
  }

  private async generateUniqueTwilioIdentity(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = `doc_${crypto.randomBytes(10).toString("hex")}`;
      const exists = await this.prisma.user.findUnique({
        where: { twilioIdentity: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new Error("Failed to generate unique Twilio identity");
  }

  private async buildAccessTokenPayload(user: {
    id: string;
    email: string;
    role: UserRole;
    twilioIdentity?: string | null;
  }) {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      twilioIdentity: user.twilioIdentity ?? undefined,
    };
  }

  private async issueTokens(params: {
    userId: string;
    email: string;
    role: UserRole;
    twilioIdentity?: string | null;
    ip?: string;
    userAgent?: string;
    rememberMe?: boolean;
  }) {
    const payload = await this.buildAccessTokenPayload({
      id: params.userId,
      email: params.email,
      role: params.role,
      twilioIdentity: params.twilioIdentity ?? undefined,
    });

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    const refreshRaw = randomToken();
    const refreshHash = sha256(refreshRaw);
    
    // If rememberMe is true, set expiration to 10 days, otherwise use default
    const refreshTtl = params.rememberMe ? "10d" : this.refreshTtl;
    const refreshExpiresAt = new Date(Date.now() + parseTtlToMs(refreshTtl));

    const refreshRow = await this.prisma.refreshToken.create({
      data: {
        userId: params.userId,
        tokenHash: refreshHash,
        userAgent: params.userAgent,
        ip: params.ip,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    return {
      accessToken,
      refreshToken: refreshRaw,
      refreshTokenId: refreshRow.id,
    };
  }

  private async sendVerificationEmail(email: string, code: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "Telemedicine <no-reply@notifications.instep.id>";

    if (!apiKey) {
      console.warn(`RESEND_API_KEY kosong. Verification code untuk ${email}: ${code}`);
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Verifikasi Email - Telemedicine",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <p>Halo,</p>
            <p>Gunakan kode berikut untuk verifikasi email registrasi kamu:</p>
            <p style="font-size: 26px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${code}</p>
            <p>Kode berlaku selama ${VERIFY_TTL_MINUTES} menit.</p>
            <p>Jika kamu tidak merasa melakukan registrasi, abaikan email ini.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal mengirim email verifikasi: ${text}`);
    }
  }

  async login(input: {
    identifier: string;
    password: string;
    ip?: string;
    userAgent?: string;
    rememberMe?: boolean;
  }) {
    const rawIdentifier = (input.identifier || "").trim();
    if (!rawIdentifier) throw new BadRequestException("Email/phone wajib diisi");

    const isEmail = rawIdentifier.includes("@");
    const lookup = isEmail
      ? { email: normalizeEmail(rawIdentifier) }
      : { phone: normalizePhone(rawIdentifier) };

    if (!isEmail && !lookup.phone) {
      throw new BadRequestException("Nomor telepon tidak valid");
    }

    const profile = await this.findProfileByIdentifier(lookup);
    const user = profile?.user;

    if (!profile || !user || !user.isActive) {
      await this.audit({
        email: isEmail ? lookup.email : undefined,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email/phone atau password salah");
    }

    if (!profile.passwordHash) {
      throw new UnauthorizedException("Akun ini menggunakan OAuth. Silakan login via Google/Microsoft");
    }

    const ok = await this.verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      await this.audit({
        userId: user.id,
        email: profile.email,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email/phone atau password salah");
    }

    const tokens = await this.issueTokens({
      userId: user.id,
      email: profile.email,
      role: user.role,
      twilioIdentity: user.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
      rememberMe: input.rememberMe,
    });

    await this.audit({
      userId: user.id,
      email: profile.email,
      action: AuthAction.LOGIN,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: profile.email,
        name: user.name,
        role: user.role,
        phone: profile.phone,
        twilioIdentity: user.twilioIdentity,
      },
    };
  }

  async register(input: {
    role: UserRole;
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    license?: string;
    adminId?: string;
    bornDate?: string;
  }) {
    const role = input.role;
    const name = (input.fullName || "").trim();
    const email = normalizeEmail(input.email || "");
    const phone = normalizePhone(input.phone || "");

    if (!name) throw new BadRequestException("Nama lengkap wajib diisi");
    if (!email) throw new BadRequestException("Email wajib diisi");
    ensurePhoneDigits(input.phone || "", phone);

    ensurePasswordPolicy(input.password);

    if (input.password !== input.confirmPassword) {
      throw new BadRequestException("Konfirmasi password tidak sama");
    }

    await this.purgeExpiredPendingRegistrations();

    const existingPending = await this.prisma.pendingRegistration.findFirst({
      where: {
        email,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    await this.ensureEmailPhoneAvailable(email, phone, {
      excludePendingId: existingPending?.id,
    });

    if (role === UserRole.DOCTOR) {
      if (!input.license?.trim()) {
        throw new BadRequestException("License wajib diisi");
      }
      await this.ensureLicenseValid(input.license.trim(), {
        excludePendingId: existingPending?.id,
      });
    }

    if (role === UserRole.ADMIN) {
      if (!input.adminId?.trim()) {
        throw new BadRequestException("Admin ID wajib diisi");
      }
      await this.ensureAdminIdValid(input.adminId.trim(), {
        excludePendingId: existingPending?.id,
      });
    }

    if (role === UserRole.PATIENT) {
      const bornDate = parseBornDate(input.bornDate);
      if (!bornDate) throw new BadRequestException("Tanggal lahir wajib diisi");
      ensureMinimumAge(bornDate, 17);
    }

    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000);

    const passwordHash = await this.hashPassword(input.password);
    const parsedBornDate = role === UserRole.PATIENT ? parseBornDate(input.bornDate) : null;

    const pending = existingPending
      ? await this.prisma.pendingRegistration.update({
          where: { id: existingPending.id },
          data: {
            role,
            email,
            phone,
            name,
            passwordHash,
            license: input.license?.trim() || null,
            adminId: input.adminId?.trim() || null,
            bornDate: parsedBornDate,
            tokenHash: codeHash,
            expiresAt,
          },
          select: { id: true },
        })
      : await this.prisma.pendingRegistration.create({
          data: {
            role,
            email,
            phone,
            name,
            passwordHash,
            license: input.license?.trim() || null,
            adminId: input.adminId?.trim() || null,
            bornDate: parsedBornDate,
            tokenHash: codeHash,
            expiresAt,
          },
          select: { id: true },
        });

    try {
      await this.sendVerificationEmail(email, verificationCode);
    } catch {
      await this.prisma.pendingRegistration.delete({ where: { id: pending.id } });
      throw new BadRequestException("Gagal mengirim email verifikasi");
    }

    await this.audit({
      email,
      action: AuthAction.REGISTER,
      success: true,
    });

    return { ok: true, expiresInMinutes: VERIFY_TTL_MINUTES };
  }

  async verifyEmail(input: { email: string; code: string }) {
    const email = normalizeEmail(input.email || "");
    const rawCode = (input.code || "").trim();
    const codeHash = sha256(rawCode);

    if (!email) throw new BadRequestException("Email wajib diisi");
    if (!rawCode) throw new BadRequestException("Kode verifikasi wajib diisi");

    await this.purgeExpiredPendingRegistrations();

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        email,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!pending) throw new BadRequestException("Kode verifikasi tidak valid atau expired");
    if (pending.tokenHash !== codeHash) {
      throw new BadRequestException("Kode verifikasi tidak valid atau expired");
    }

    await this.ensureEmailPhoneAvailable(pending.email, pending.phone, {
      excludePendingId: pending.id,
    });

    if (pending.role === UserRole.DOCTOR && pending.license) {
      await this.ensureLicenseValid(pending.license, { excludePendingId: pending.id });
    }
    if (pending.role === UserRole.ADMIN && pending.adminId) {
      await this.ensureAdminIdValid(pending.adminId, { excludePendingId: pending.id });
    }

    if (pending.role === UserRole.PATIENT && pending.bornDate) {
      ensureMinimumAge(pending.bornDate, 17);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          role: pending.role,
          name: pending.name,
          emailVerifiedAt: new Date(),
          isActive: true,
          twilioIdentity:
            pending.role === UserRole.DOCTOR
              ? await this.generateUniqueTwilioIdentity()
              : null,
        },
      });

      if (pending.role === UserRole.DOCTOR) {
        await tx.doctorProfile.create({
          data: {
            userId: newUser.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            license: pending.license!,
          },
        });
      }

      if (pending.role === UserRole.ADMIN) {
        await tx.adminProfile.create({
          data: {
            userId: newUser.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            adminId: pending.adminId!,
          },
        });
      }

      if (pending.role === UserRole.PATIENT) {
        await tx.patientProfile.create({
          data: {
            userId: newUser.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            bornDate: pending.bornDate!,
          },
        });
      }

      await tx.pendingRegistration.delete({ where: { id: pending.id } });

      return newUser;
    });

    // Issue tokens for auto-login
    const profile = await this.getProfileByUserId(user.id, user.role);
    const tokens = await this.issueTokens({
      userId: user.id,
      email: profile!.email,
      role: user.role,
      twilioIdentity: user.twilioIdentity,
    });

    return {
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: profile!.email,
        name: user.name,
        role: user.role,
        phone: profile!.phone,
        twilioIdentity: user.twilioIdentity,
      },
    };
  }

  async getOAuthStartUrl(input: {
    provider: string;
    role: string;
    redirectUrl?: string;
  }) {
    const provider = this.parseProvider(input.provider);
    const role = this.parseRole(input.role);

    const state = await this.prisma.oauthState.create({
      data: {
        provider,
        role,
        redirectUrl: input.redirectUrl || null,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60_000),
      },
    });

    const redirectUri = this.getProviderRedirectUri(provider);
    if (provider === OAuthProvider.GOOGLE) {
      const params = new URLSearchParams({
        client_id: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: state.id,
        access_type: "offline",
        prompt: "consent",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID || "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: state.id,
      prompt: "select_account",
    });

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  private getProviderRedirectUri(provider: OAuthProvider) {
    if (provider === OAuthProvider.GOOGLE) {
      return (
        process.env.OAUTH_GOOGLE_REDIRECT_URI ||
        `${this.backendBaseUrl}/auth/oauth/google/callback`
      );
    }

    return (
      process.env.OAUTH_MICROSOFT_REDIRECT_URI ||
      `${this.backendBaseUrl}/auth/oauth/microsoft/callback`
    );
  }

  async handleOAuthCallback(input: {
    provider: string;
    query: Record<string, string | undefined>;
    ip?: string;
    userAgent?: string;
  }) {
    const provider = this.parseProvider(input.provider);

    if (input.query.error) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=${encodeURIComponent(
          input.query.error,
        )}`,
      };
    }

    const code = input.query.code;
    const state = input.query.state;

    if (!code || !state) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=missing_code`,
      };
    }

    const oauthState = await this.prisma.oauthState.findUnique({ where: { id: state } });
    if (!oauthState || oauthState.expiresAt.getTime() <= Date.now()) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=invalid_state`,
      };
    }

    await this.prisma.oauthState.delete({ where: { id: oauthState.id } });

    let profile: { email?: string; name?: string; providerUserId: string };
    try {
      profile =
        provider === OAuthProvider.GOOGLE
          ? await this.fetchGoogleProfile(code)
          : await this.fetchMicrosoftProfile(code);
    } catch {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=oauth_failed`,
      };
    }

    const email = normalizeEmail(profile.email || "");
    if (!email) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=missing_email`,
      };
    }
    if (!profile.providerUserId) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=missing_account`,
      };
    }

    const existingProfile = await this.findProfileByIdentifier({ email });
    const existingUser = existingProfile?.user;

    if (existingUser && existingUser.role !== oauthState.role) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=email_used`,
      };
    }

    if (existingUser) {
      if (!existingUser.isActive) {
        return {
          redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=inactive`,
        };
      }
      await this.prisma.oauthAccount.upsert({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId: profile.providerUserId,
          },
        },
        update: { userId: existingUser.id, email },
        create: {
          userId: existingUser.id,
          provider,
          providerUserId: profile.providerUserId,
          email,
        },
      });

      const tokens = await this.issueTokens({
        userId: existingUser.id,
        email: existingProfile!.email,
        role: existingUser.role,
        twilioIdentity: existingUser.twilioIdentity,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      await this.audit({
        userId: existingUser.id,
        email: existingProfile!.email,
        action: AuthAction.LOGIN,
        success: true,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      const redirectUrl = `${this.frontendBaseUrl}/auth/oauth/success?accessToken=${encodeURIComponent(
        tokens.accessToken,
      )}`;

      return { redirectUrl, refreshToken: tokens.refreshToken };
    }

    const pending = await this.prisma.oauthPending.upsert({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId: profile.providerUserId,
        },
      },
      update: {
        role: oauthState.role,
        email,
        name: profile.name || null,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000),
      },
      create: {
        provider,
        role: oauthState.role,
        providerUserId: profile.providerUserId,
        email,
        name: profile.name || null,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000),
      },
    });

    return {
      redirectUrl: `${this.frontendBaseUrl}/auth/oauth/complete?token=${pending.id}&role=${pending.role}`,
    };
  }

  private async fetchGoogleProfile(code: string) {
    const redirectUri = this.getProviderRedirectUri(OAuthProvider.GOOGLE);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
        client_secret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new BadRequestException("OAuth Google gagal");
    }

    const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const userJson = await userRes.json();

    return {
      email: userJson.email as string | undefined,
      name: userJson.name as string | undefined,
      providerUserId: userJson.sub as string,
    };
  }

  private async fetchMicrosoftProfile(code: string) {
    const redirectUri = this.getProviderRedirectUri(OAuthProvider.MICROSOFT);
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID || "",
        client_secret: process.env.OAUTH_MICROSOFT_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "openid email profile",
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new BadRequestException("OAuth Microsoft gagal");
    }

    const userRes = await fetch("https://graph.microsoft.com/oidc/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const userJson = await userRes.json();

    return {
      email: (userJson.email || userJson.preferred_username) as string | undefined,
      name: userJson.name as string | undefined,
      providerUserId: (userJson.sub || userJson.oid) as string,
    };
  }

  async completeOAuth(input: {
    token: string;
    phone: string;
    name?: string;
    license?: string;
    adminId?: string;
    bornDate?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const pending = await this.prisma.oauthPending.findUnique({
      where: { id: input.token },
    });

    if (!pending) throw new BadRequestException("Token OAuth tidak valid");
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.prisma.oauthPending.delete({ where: { id: pending.id } });
      throw new BadRequestException("Token OAuth sudah expired");
    }

    const email = normalizeEmail(pending.email);
    const phone = normalizePhone(input.phone || "");
    ensurePhoneDigits(input.phone || "", phone);

    const name = (input.name || pending.name || "").trim();
    if (!name) throw new BadRequestException("Nama lengkap wajib diisi");

    await this.ensureEmailPhoneAvailable(email, phone);

    if (pending.role === UserRole.DOCTOR) {
      const license = (input.license || "").trim();
      if (!license) throw new BadRequestException("License wajib diisi");
      await this.ensureLicenseValid(license);
    }

    if (pending.role === UserRole.ADMIN) {
      const adminId = (input.adminId || "").trim();
      if (!adminId) throw new BadRequestException("Admin ID wajib diisi");
      await this.ensureAdminIdValid(adminId);
    }

    if (pending.role === UserRole.PATIENT) {
      const bornDate = parseBornDate(input.bornDate);
      if (!bornDate) throw new BadRequestException("Tanggal lahir wajib diisi");
      ensureMinimumAge(bornDate, 17);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          role: pending.role,
          name,
          emailVerifiedAt: new Date(),
          isActive: true,
          twilioIdentity:
            pending.role === UserRole.DOCTOR
              ? await this.generateUniqueTwilioIdentity()
              : null,
        },
      });

      if (pending.role === UserRole.DOCTOR) {
        await tx.doctorProfile.create({
          data: {
            userId: newUser.id,
            fullName: name,
            email,
            phone,
            passwordHash: null,
            license: input.license!.trim(),
          },
        });
      }

      if (pending.role === UserRole.ADMIN) {
        await tx.adminProfile.create({
          data: {
            userId: newUser.id,
            fullName: name,
            email,
            phone,
            passwordHash: null,
            adminId: input.adminId!.trim(),
          },
        });
      }

      if (pending.role === UserRole.PATIENT) {
        await tx.patientProfile.create({
          data: {
            userId: newUser.id,
            fullName: name,
            email,
            phone,
            passwordHash: null,
            bornDate: parseBornDate(input.bornDate)!,
          },
        });
      }

      await tx.oauthAccount.create({
        data: {
          userId: newUser.id,
          provider: pending.provider,
          providerUserId: pending.providerUserId,
          email,
        },
      });

      await tx.oauthPending.delete({ where: { id: pending.id } });

      return newUser;
    });

    const tokens = await this.issueTokens({
      userId: created.id,
      email,
      role: created.role,
      twilioIdentity: created.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: created.id,
        email,
        name: created.name,
        role: created.role,
        phone,
        twilioIdentity: created.twilioIdentity,
      },
    };
  }

  async refresh(input: {
    refreshToken: string;
    ip?: string;
    userAgent?: string;
  }) {
    const tokenHash = sha256(input.refreshToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      await this.audit({
        action: AuthAction.REFRESH,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Refresh token invalid");
    }

    if (existing.revokedAt) throw new UnauthorizedException("Refresh token revoked");
    if (existing.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Refresh token expired");
    if (!existing.user.isActive) throw new UnauthorizedException("User inactive");

    const profile = await this.getProfileByUserId(existing.user.id, existing.user.role);
    if (!profile) throw new UnauthorizedException("Profil user tidak ditemukan");

    // ROTATE refresh token
    const newRefreshRaw = randomToken();
    const newRefreshHash = sha256(newRefreshRaw);
    const newExpiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: newRefreshHash,
        userAgent: input.userAgent,
        ip: input.ip,
        expiresAt: newExpiresAt,
        replacesToken: { connect: { id: existing.id } },
      },
      select: { id: true },
    });

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: created.id,
      },
    });

    const payload = await this.buildAccessTokenPayload({
      id: existing.user.id,
      email: profile.email,
      role: existing.user.role,
      twilioIdentity: existing.user.twilioIdentity,
    });

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    await this.audit({
      userId: existing.userId,
      email: profile.email,
      action: AuthAction.REFRESH,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken: newRefreshRaw,
      refreshTokenId: created.id,
      user: {
        id: existing.user.id,
        email: profile.email,
        name: existing.user.name,
        role: existing.user.role,
        phone: profile.phone,
        twilioIdentity: existing.user.twilioIdentity,
      },
    };
  }

  async oauthSession(input: {
    accessToken: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!input.accessToken) throw new UnauthorizedException("Access token wajib diisi");

    let payload: JwtPayload | null = null;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(input.accessToken, {
        secret: process.env.JWT_ACCESS_SECRET!,
      });
    } catch {
      throw new UnauthorizedException("Access token invalid");
    }

    if (!payload?.sub) throw new UnauthorizedException("Access token invalid");

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) throw new UnauthorizedException("Invalid token");

    const profile = await this.getProfileByUserId(user.id, user.role);
    if (!profile) throw new UnauthorizedException("Profil user tidak ditemukan");

    const tokens = await this.issueTokens({
      userId: user.id,
      email: profile.email,
      role: user.role,
      twilioIdentity: user.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    await this.audit({
      userId: user.id,
      email: profile.email,
      action: AuthAction.LOGIN,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: profile.email,
        name: user.name,
        role: user.role,
        phone: profile.phone,
        twilioIdentity: user.twilioIdentity,
      },
    };
  }

  async logout(input: {
    refreshToken?: string;
    revokeAll?: boolean;
    userId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (input.revokeAll) {
      if (!input.userId) throw new ForbiddenException("userId required");

      await this.prisma.refreshToken.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.audit({
        userId: input.userId,
        action: AuthAction.LOGOUT,
        success: true,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return { ok: true, revokedAll: true };
    }

    if (!input.refreshToken) return { ok: true };

    const tokenHash = sha256(input.refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });

    if (!row) return { ok: true };

    if (!row.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit({
      userId: row.userId,
      action: AuthAction.LOGOUT,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { ok: true };
  }

  async getDoctorProfile(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        license: true,
      },
    });

    if (!profile) throw new BadRequestException("Profil dokter tidak ditemukan");
    return profile;
  }

  async getAdminProfile(userId: string) {
    const profile = await this.prisma.adminProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        adminId: true,
      },
    });

    if (!profile) throw new BadRequestException("Profil admin tidak ditemukan");
    return profile;
  }

  async getPatientProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bornDate: true,
      },
    });

    if (!profile) throw new BadRequestException("Profil pasien tidak ditemukan");
    return profile;
  }

  async updateDoctorProfile(
    userId: string,
    input: {
      fullName?: string;
      phone?: string;
      password?: string;
    },
  ) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new BadRequestException("Profil dokter tidak ditemukan");

    const data: Record<string, any> = {};

    if (input.fullName?.trim()) {
      data.fullName = input.fullName.trim();
    }

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);

      const existing = await this.prisma.doctorProfile.findFirst({
        where: {
          phone,
          id: { not: profile.id },
        },
        select: { id: true },
      });

      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    const updated = await this.prisma.doctorProfile.update({
      where: { userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        license: true,
      },
    });

    if (data.fullName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: data.fullName },
      });
    }

    return updated;
  }

  async updateAdminProfile(
    userId: string,
    input: {
      fullName?: string;
      phone?: string;
      password?: string;
    },
  ) {
    const profile = await this.prisma.adminProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new BadRequestException("Profil admin tidak ditemukan");

    const data: Record<string, any> = {};

    if (input.fullName?.trim()) {
      data.fullName = input.fullName.trim();
    }

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);

      const existing = await this.prisma.adminProfile.findFirst({
        where: {
          phone,
          id: { not: profile.id },
        },
        select: { id: true },
      });

      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    const updated = await this.prisma.adminProfile.update({
      where: { userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        adminId: true,
      },
    });

    if (data.fullName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: data.fullName },
      });
    }

    return updated;
  }

  async updatePatientProfile(
    userId: string,
    input: {
      fullName?: string;
      phone?: string;
      bornDate?: string;
      password?: string;
    },
  ) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new BadRequestException("Profil pasien tidak ditemukan");

    const data: Record<string, any> = {};

    if (input.fullName?.trim()) {
      data.fullName = input.fullName.trim();
    }

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);

      const existing = await this.prisma.patientProfile.findFirst({
        where: {
          phone,
          id: { not: profile.id },
        },
        select: { id: true },
      });

      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.bornDate?.trim()) {
      const bornDate = parseBornDate(input.bornDate);
      ensureMinimumAge(bornDate!, 17);
      data.bornDate = bornDate;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    const updated = await this.prisma.patientProfile.update({
      where: { userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bornDate: true,
      },
    });

    if (data.fullName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: data.fullName },
      });
    }

    return updated;
  }

  // Email Change Flow
  async requestEmailChange(userId: string, input: { newEmail: string; password: string }) {
    const newEmail = normalizeEmail(input.newEmail);
    const profile = await this.findProfileByUserId(userId);

    if (!profile) throw new BadRequestException("Profil tidak ditemukan");
    if (!profile.passwordHash) {
      throw new BadRequestException("Akun OAuth tidak bisa mengganti email dengan cara ini");
    }

    // Verify password
    const passwordOk = await this.verifyPassword(input.password, profile.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException("Password salah");
    }

    // Check if new email is already in use
    const existing = await this.prisma.$transaction([
      this.prisma.doctorProfile.findFirst({
        where: { email: newEmail, userId: { not: userId } },
        select: { id: true },
      }),
      this.prisma.adminProfile.findFirst({
        where: { email: newEmail, userId: { not: userId } },
        select: { id: true },
      }),
      this.prisma.patientProfile.findFirst({
        where: { email: newEmail, userId: { not: userId } },
        select: { id: true },
      }),
    ]);

    if (existing.some(Boolean)) {
      throw new BadRequestException("Email sudah digunakan di akun lain");
    }

    // Generate verification code
    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + 30 * 60_000); // 30 minutes

    // Delete any existing pending email changes
    await this.prisma.pendingEmailChange.deleteMany({
      where: { userId },
    });

    // Create pending email change
    await this.prisma.pendingEmailChange.create({
      data: {
        userId,
        newEmail,
        tokenHash: codeHash,
        expiresAt,
      },
    });

    // Send verification email
    try {
      await this.sendVerificationEmail(newEmail, verificationCode);
    } catch {
      await this.prisma.pendingEmailChange.deleteMany({ where: { userId } });
      throw new BadRequestException("Gagal mengirim email verifikasi");
    }

    return { ok: true, expiresInMinutes: 30 };
  }

  async confirmEmailChange(userId: string, input: { newEmail: string; code: string }) {
    const newEmail = normalizeEmail(input.newEmail);
    const rawCode = (input.code || "").trim();
    const codeHash = sha256(rawCode);

    const pending = await this.prisma.pendingEmailChange.findFirst({
      where: {
        userId,
        newEmail,
        expiresAt: { gt: new Date() },
      },
    });

    if (!pending || pending.tokenHash !== codeHash) {
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");
    }

    const profile = await this.findProfileByUserId(userId);
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    // Update email in the appropriate profile table
    const updated = await this.prisma.$transaction(async (tx) => {
      if (profile.user.role === UserRole.DOCTOR) {
        await tx.doctorProfile.update({
          where: { userId },
          data: { email: newEmail },
        });
      } else if (profile.user.role === UserRole.ADMIN) {
        await tx.adminProfile.update({
          where: { userId },
          data: { email: newEmail },
        });
      } else {
        await tx.patientProfile.update({
          where: { userId },
          data: { email: newEmail },
        });
      }

      // Delete pending email change
      await tx.pendingEmailChange.delete({ where: { id: pending.id } });
    });

    return { ok: true };
  }

  // Password Reset Flow
  async requestPasswordReset(userId: string) {
    const profile = await this.findProfileByUserId(userId);
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    if (!profile.passwordHash) {
      throw new BadRequestException("Akun OAuth tidak bisa menggunakan fitur ini");
    }

    // Generate verification code
    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 minutes

    // Delete any existing pending password resets
    await this.prisma.pendingPasswordReset.deleteMany({
      where: { userId },
    });

    // Create pending password reset
    await this.prisma.pendingPasswordReset.create({
      data: {
        userId,
        tokenHash: codeHash,
        expiresAt,
      },
    });

    // Send verification code to email
    try {
      await this.sendVerificationEmail(profile.email, verificationCode);
    } catch {
      await this.prisma.pendingPasswordReset.deleteMany({ where: { userId } });
      throw new BadRequestException("Gagal mengirim kode verifikasi");
    }

    return { ok: true, expiresInMinutes: 10 };
  }

  async verifyResetCode(userId: string, code: string) {
    const rawCode = (code || "").trim();
    const codeHash = sha256(rawCode);

    const pending = await this.prisma.pendingPasswordReset.findFirst({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
    });

    if (!pending || pending.tokenHash !== codeHash) {
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");
    }

    return { ok: true };
  }

  async setNewPassword(userId: string, input: { code: string; newPassword: string }) {
    const rawCode = (input.code || "").trim();
    const codeHash = sha256(rawCode);

    ensurePasswordPolicy(input.newPassword);

    const pending = await this.prisma.pendingPasswordReset.findFirst({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
    });

    if (!pending || pending.tokenHash !== codeHash) {
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");
    }

    const profile = await this.findProfileByUserId(userId);
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    const passwordHash = await this.hashPassword(input.newPassword);

    // Update password in the appropriate profile table
    await this.prisma.$transaction(async (tx) => {
      if (profile.user.role === UserRole.DOCTOR) {
        await tx.doctorProfile.update({
          where: { userId },
          data: { passwordHash },
        });
      } else if (profile.user.role === UserRole.ADMIN) {
        await tx.adminProfile.update({
          where: { userId },
          data: { passwordHash },
        });
      } else {
        await tx.patientProfile.update({
          where: { userId },
          data: { passwordHash },
        });
      }

      // Delete pending password reset
      await tx.pendingPasswordReset.delete({ where: { id: pending.id } });

      // Revoke all refresh tokens for this user
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { ok: true };
  }

  // Profile Picture Upload
  async uploadProfilePicture(userId: string, filePath: string) {
    const profile = await this.findProfileByUserId(userId);
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    await this.prisma.$transaction(async (tx) => {
      if (profile.user.role === UserRole.DOCTOR) {
        await tx.doctorProfile.update({
          where: { userId },
          data: { profilePicture: filePath },
        });
      } else if (profile.user.role === UserRole.ADMIN) {
        await tx.adminProfile.update({
          where: { userId },
          data: { profilePicture: filePath },
        });
      } else {
        await tx.patientProfile.update({
          where: { userId },
          data: { profilePicture: filePath },
        });
      }
    });

    return { ok: true, profilePicture: filePath };
  }

  private async findProfileByUserId(userId: string) {
    const [doctor, admin, patient] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findFirst({
        where: { userId },
        include: { user: true },
      }),
      this.prisma.adminProfile.findFirst({
        where: { userId },
        include: { user: true },
      }),
      this.prisma.patientProfile.findFirst({
        where: { userId },
        include: { user: true },
      }),
    ]);

    const profiles = [doctor, admin, patient].filter(Boolean) as ProfileWithUser[];
    if (profiles.length === 0) return null;
    return profiles[0];
  }
}

