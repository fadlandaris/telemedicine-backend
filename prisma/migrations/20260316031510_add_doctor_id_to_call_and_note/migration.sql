-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "doctorId" TEXT;

-- AlterTable
ALTER TABLE "ConsultationNote" ADD COLUMN     "doctorId" TEXT;

-- CreateIndex
CREATE INDEX "CallSession_doctorId_idx" ON "CallSession"("doctorId");

-- CreateIndex
CREATE INDEX "CallSession_doctorId_createdAt_idx" ON "CallSession"("doctorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CallSession_consultationId_idx" ON "CallSession"("consultationId");

-- CreateIndex
CREATE INDEX "ConsultationNote_doctorId_idx" ON "ConsultationNote"("doctorId");

-- CreateIndex
CREATE INDEX "ConsultationNote_doctorId_createdAt_idx" ON "ConsultationNote"("doctorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ConsultationNote_consultationId_idx" ON "ConsultationNote"("consultationId");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
