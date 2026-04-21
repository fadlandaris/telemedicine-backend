import { Module } from "@nestjs/common";
import { ProfileController } from "./profile.controller";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "prisma/prisma.service";
import { JwtModule } from "@nestjs/jwt";

@Module({
  imports: [JwtModule.register({})],
  controllers: [ProfileController],
  providers: [AuthService, PrismaService],
})
export class ProfileModule {}
