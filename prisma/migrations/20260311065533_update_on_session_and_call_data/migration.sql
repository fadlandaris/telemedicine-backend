-- DropForeignKey
ALTER TABLE "CallSession" DROP CONSTRAINT "CallSession_consultationId_fkey";

-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "compositionReadyAt" TIMESTAMP(3),
ADD COLUMN     "compositionStartedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "recordingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "recordingStartedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CallStatus" NOT NULL DEFAULT 'STARTED';

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
