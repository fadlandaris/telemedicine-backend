-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('SCHEDULED', 'INSTANT');

-- CreateEnum
CREATE TYPE "ConsultationMode" AS ENUM ('VIDEO', 'VOICE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');

-- DropForeignKey
ALTER TABLE "CallSession" DROP CONSTRAINT "CallSession_consultationId_fkey";

-- DropForeignKey
ALTER TABLE "CallSession" DROP CONSTRAINT "CallSession_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "Consultation" DROP CONSTRAINT "Consultation_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "ConsultationNote" DROP CONSTRAINT "ConsultationNote_consultationId_fkey";

-- DropForeignKey
ALTER TABLE "ConsultationNote" DROP CONSTRAINT "ConsultationNote_doctorId_fkey";

-- DropIndex
DROP INDEX "ConsultationNote_consultationId_idx";

-- DropIndex
DROP INDEX "ConsultationNote_consultationId_key";

-- AlterTable
ALTER TABLE "ConsultationNote"
ADD COLUMN "consultation_session_id" TEXT;

-- Data reset for incompatible relation migration
DELETE FROM "ConsultationNote";

-- AlterTable
ALTER TABLE "ConsultationNote"
DROP COLUMN "consultationId",
ALTER COLUMN "doctorId" SET NOT NULL,
ALTER COLUMN "consultation_session_id" SET NOT NULL;

-- DropTable
DROP TABLE "CallSession";

-- DropTable
DROP TABLE "Consultation";

-- DropEnum
DROP TYPE "CallStatus";

-- DropEnum
DROP TYPE "ConsultationStatus";

-- CreateTable
CREATE TABLE "ConsultationSession" (
    "session_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "session_type" "SessionType" NOT NULL,
    "consultation_mode" "ConsultationMode" NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "scheduled_start_time" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER,
    "scheduled_end_time" TIMESTAMP(3),
    "session_status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
    "created_by" TEXT NOT NULL,
    "room_name" TEXT NOT NULL,
    "twilio_room_sid" TEXT,
    "doctor_identity" TEXT,
    "patient_identity" TEXT,
    "patient_name" TEXT,
    "patient_country_code" TEXT,
    "patient_country" TEXT,
    "patient_province" TEXT,
    "patient_city" TEXT,
    "patient_latitude" DOUBLE PRECISION,
    "patient_longitude" DOUBLE PRECISION,
    "doctor_joined_at" TIMESTAMP(3),
    "patient_joined_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recording_status" TEXT,
    "recording_started_at" TIMESTAMP(3),
    "recording_completed_at" TIMESTAMP(3),
    "composition_sid" TEXT,
    "composition_status" TEXT,
    "composition_started_at" TIMESTAMP(3),
    "composition_ready_at" TIMESTAMP(3),
    "media_url" TEXT,
    "media_format" TEXT,
    "duration_sec" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationSession_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "ConsultationSessionAudit" (
    "id" TEXT NOT NULL,
    "consultation_session_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" "UserRole",
    "action" TEXT NOT NULL,
    "previous_status" "SessionStatus",
    "new_status" "SessionStatus",
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationSessionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_room_name_key" ON "ConsultationSession"("room_name");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_twilio_room_sid_key" ON "ConsultationSession"("twilio_room_sid");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_composition_sid_key" ON "ConsultationSession"("composition_sid");

-- CreateIndex
CREATE INDEX "ConsultationSession_doctor_id_idx" ON "ConsultationSession"("doctor_id");

-- CreateIndex
CREATE INDEX "ConsultationSession_patient_id_idx" ON "ConsultationSession"("patient_id");

-- CreateIndex
CREATE INDEX "ConsultationSession_created_by_idx" ON "ConsultationSession"("created_by");

-- CreateIndex
CREATE INDEX "ConsultationSession_session_status_idx" ON "ConsultationSession"("session_status");

-- CreateIndex
CREATE INDEX "ConsultationSession_scheduled_start_time_idx" ON "ConsultationSession"("scheduled_start_time");

-- CreateIndex
CREATE INDEX "ConsultationSession_scheduled_end_time_idx" ON "ConsultationSession"("scheduled_end_time");

-- CreateIndex
CREATE INDEX "ConsultationSession_doctor_id_scheduled_start_time_idx" ON "ConsultationSession"("doctor_id", "scheduled_start_time");

-- CreateIndex
CREATE INDEX "ConsultationSession_patient_id_scheduled_start_time_idx" ON "ConsultationSession"("patient_id", "scheduled_start_time");

-- CreateIndex
CREATE INDEX "ConsultationSessionAudit_consultation_session_id_idx" ON "ConsultationSessionAudit"("consultation_session_id");

-- CreateIndex
CREATE INDEX "ConsultationSessionAudit_actor_user_id_idx" ON "ConsultationSessionAudit"("actor_user_id");

-- CreateIndex
CREATE INDEX "ConsultationSessionAudit_created_at_idx" ON "ConsultationSessionAudit"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationNote_consultation_session_id_key" ON "ConsultationNote"("consultation_session_id");

-- CreateIndex
CREATE INDEX "ConsultationNote_consultation_session_id_idx" ON "ConsultationNote"("consultation_session_id");

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_consultation_session_id_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSessionAudit" ADD CONSTRAINT "ConsultationSessionAudit_consultation_session_id_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSessionAudit" ADD CONSTRAINT "ConsultationSessionAudit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
