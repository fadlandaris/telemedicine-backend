/*
  Warnings:

  - You are about to drop the column `callSid` on the `CallSession` table. All the data in the column will be lost.
  - You are about to drop the column `recordingSid` on the `CallSession` table. All the data in the column will be lost.
  - You are about to drop the column `recordingUrl` on the `CallSession` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `CallSession` table. All the data in the column will be lost.
  - You are about to drop the column `streamSid` on the `CallSession` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[roomSid]` on the table `CallSession` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[compositionSid]` on the table `CallSession` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "CallSession" DROP CONSTRAINT "CallSession_consultationId_fkey";

-- DropIndex
DROP INDEX "CallSession_callSid_key";

-- DropIndex
DROP INDEX "CallSession_status_idx";

-- AlterTable
ALTER TABLE "CallSession" DROP COLUMN "callSid",
DROP COLUMN "recordingSid",
DROP COLUMN "recordingUrl",
DROP COLUMN "status",
DROP COLUMN "streamSid",
ADD COLUMN     "compositionSid" TEXT,
ADD COLUMN     "compositionStatus" TEXT,
ADD COLUMN     "doctorIdentity" TEXT,
ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "mediaFormat" TEXT,
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "patientIdentity" TEXT,
ADD COLUMN     "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordingStatus" TEXT,
ADD COLUMN     "roomName" TEXT,
ADD COLUMN     "roomSid" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_roomSid_key" ON "CallSession"("roomSid");

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_compositionSid_key" ON "CallSession"("compositionSid");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
