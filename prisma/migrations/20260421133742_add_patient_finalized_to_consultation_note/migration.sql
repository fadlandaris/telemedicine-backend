-- AlterTable: add patient_id as nullable first, then backfill, then constrain
ALTER TABLE "ConsultationNote"
  ADD COLUMN "finalized_at" TIMESTAMP(3),
  ADD COLUMN "is_finalized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "patient_id" TEXT;

-- Backfill patient_id from the linked ConsultationSession
UPDATE "ConsultationNote" cn
SET "patient_id" = cs."patient_id"
FROM "ConsultationSession" cs
WHERE cn."consultation_session_id" = cs."session_id";

-- Now make patient_id NOT NULL
ALTER TABLE "ConsultationNote" ALTER COLUMN "patient_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ConsultationNote_patient_id_idx" ON "ConsultationNote"("patient_id");

-- CreateIndex
CREATE INDEX "ConsultationNote_patient_id_createdAt_idx" ON "ConsultationNote"("patient_id", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
