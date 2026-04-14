import { UserRole } from "@prisma/client";

export type JwtPayload = {
  sub: string; // userId
  email: string;
  role: UserRole;
  twilioIdentity?: string;
};
