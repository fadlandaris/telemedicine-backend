import { ForbiddenException, Injectable, UnauthorizedException} from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import crypto from "crypto";
import { AuthAction } from "@prisma/client";
import type { StringValue } from "ms";


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
    unit === "s" ? 1000 :
    unit === "m" ? 60_000 :
    unit === "h" ? 3_600_000 :
    86_400_000; // d
  return n * mult;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private accessTtl = process.env.JWT_ACCESS_TTL || "15m";
  private refreshTtl = process.env.JWT_REFRESH_TTL || "30d";

  private async audit(params: {
    doctorId?: string;
    email?: string;
    action: AuthAction;
    success: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    await this.prisma.authAuditLog.create({
      data: {
        doctorId: params.doctorId,
        email: params.email,
        action: params.action,
        success: params.success,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  }

  private async verifyPasswordSeedCompatible(raw: string, passwordHash: string) {
    // kompatibel seeder: passwordHash = sha256(password)
    return sha256(raw) === passwordHash;
  }

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (!doctor || !doctor.isActive) {
      await this.audit({
        email: input.email,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email / password salah");
    }

    const ok = await this.verifyPasswordSeedCompatible(input.password, doctor.passwordHash);
    if (!ok) {
      await this.audit({
        doctorId: doctor.id,
        email: doctor.email,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email / password salah");
    }

    // access token (JWT)
    const payload = {
      sub: doctor.id,
      email: doctor.email,
      twilioIdentity: doctor.twilioIdentity,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    // refresh token = random + simpan hash di DB
    const refreshRaw = randomToken();
    const refreshHash = sha256(refreshRaw);
    const refreshExpiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    const refreshRow = await this.prisma.refreshToken.create({
      data: {
        doctorId: doctor.id,
        tokenHash: refreshHash,
        userAgent: input.userAgent,
        ip: input.ip,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    await this.audit({
      doctorId: doctor.id,
      email: doctor.email,
      action: AuthAction.LOGIN,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken: refreshRaw,
      refreshTokenId: refreshRow.id,
      doctor: {
        id: doctor.id,
        email: doctor.email,
        name: doctor.name,
        twilioIdentity: doctor.twilioIdentity,
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
      include: { doctor: true },
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
    if (!existing.doctor.isActive) throw new UnauthorizedException("Doctor inactive");

    // ROTATE refresh token
    const newRefreshRaw = randomToken();
    const newRefreshHash = sha256(newRefreshRaw);
    const newExpiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    const created = await this.prisma.refreshToken.create({
      data: {
        doctorId: existing.doctorId,
        tokenHash: newRefreshHash,
        userAgent: input.userAgent,
        ip: input.ip,
        expiresAt: newExpiresAt,
        replacesToken: { connect: { id: existing.id } }, // relation RefreshTokenReplacement
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

    const payload = {
      sub: existing.doctor.id,
      email: existing.doctor.email,
      twilioIdentity: existing.doctor.twilioIdentity,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    await this.audit({
      doctorId: existing.doctorId,
      email: existing.doctor.email,
      action: AuthAction.REFRESH,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken: newRefreshRaw,
      refreshTokenId: created.id,
    };
  }

  async logout(input: {
    refreshToken?: string;
    revokeAll?: boolean;
    doctorId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (input.revokeAll) {
      if (!input.doctorId) throw new ForbiddenException("doctorId required");

      await this.prisma.refreshToken.updateMany({
        where: { doctorId: input.doctorId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.audit({
        doctorId: input.doctorId,
        action: AuthAction.LOGOUT,
        success: true,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return { ok: true, revokedAll: true };
    }

    if (!input.refreshToken) return { ok: true }; // idempotent

    const tokenHash = sha256(input.refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, doctorId: true, revokedAt: true },
    });

    if (!row) return { ok: true }; // idempotent

    if (!row.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit({
      doctorId: row.doctorId,
      action: AuthAction.LOGOUT,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { ok: true };
  }
}
