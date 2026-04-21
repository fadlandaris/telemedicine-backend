import { UserRole } from "@prisma/client";

export type JwtPayload = {
  id: string;
  sub: string; // userId
  email: string;
  role: UserRole;
  twilioIdentity?: string;
};
