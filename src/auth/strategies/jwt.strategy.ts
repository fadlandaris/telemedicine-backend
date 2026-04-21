import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "prisma/prisma.service";
import { UserRole } from "@prisma/client";
import { JwtPayload } from "../types/jwt-payload";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        twilioIdentity: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) throw new UnauthorizedException("Invalid token");

    let email = "";
    if (user.role === UserRole.DOCTOR) {
      const profile = await this.prisma.doctorProfile.findUnique({
        where: { userId: user.id },
        select: { email: true },
      });
      if (!profile) throw new UnauthorizedException("Invalid token");
      email = profile.email;
    } else if (user.role === UserRole.ADMIN) {
      const profile = await this.prisma.adminProfile.findUnique({
        where: { userId: user.id },
        select: { email: true },
      });
      if (!profile) throw new UnauthorizedException("Invalid token");
      email = profile.email;
    } else {
      const profile = await this.prisma.patientProfile.findUnique({
        where: { userId: user.id },
        select: { email: true },
      });
      if (!profile) throw new UnauthorizedException("Invalid token");
      email = profile.email;
    }

    return {
      id: user.id,
      sub: payload.sub,
      email,
      role: user.role,
      twilioIdentity: user.twilioIdentity,
    };
  }
}
