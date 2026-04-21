import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ProfileModule } from "./profile/profile.module";
import { ThrottlerModule } from "@nestjs/throttler";
import { ConsultationsModule } from "./consultations/consultations.module";
import { TwilioModule } from "./twilio/twilio.module";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { AiModule } from "./ai-summary/ai.module";
import { CallModule } from "./call/call.module";
import { AiResultsModule } from "./ai-results/ai-results.module";
import { SoapNotesModule } from "./soap-notes/soap-notes.module";
import { MulterModule } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { existsSync, mkdirSync } from "fs";

const uploadsDir = join(process.cwd(), "uploads", "profiles");

// Ensure upload directory exists
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: 100 },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "uploads"),
      serveRoot: "/uploads",
    }),
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
          const timestamp = Date.now();
          const ext = file.mimetype.split("/")[1];
          cb(null, `${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`);
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    ProfileModule,
    ConsultationsModule,
    TwilioModule,
    AiModule,
    CallModule,
    AiResultsModule,
    SoapNotesModule,
  ],
})
export class AppModule {}