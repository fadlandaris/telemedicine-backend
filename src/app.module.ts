import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ThrottlerModule } from "@nestjs/throttler";
import { ConsultationsModule } from "./consultations/consultations.module";
import { TwilioModule } from "./twilio/twilio.module";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { AiModule } from "./ai-summary/ai.module";

@Module({
  imports: [
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
    PrismaModule,
    AuthModule,
    ConsultationsModule,
    TwilioModule,
    AiModule
  ],
})
export class AppModule {}