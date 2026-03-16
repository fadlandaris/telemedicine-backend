import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "prisma/prisma.service";
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
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, twilioIdentity: true, isActive: true },
    });

    if (!doctor || !doctor.isActive) throw new UnauthorizedException("Invalid token");
    return doctor; // nempel di req.user
  }
}
