/*
  Warnings:

  - A unique constraint covering the columns `[roomName]` on the table `Consultation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[twilioRoomSid]` on the table `Consultation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `roomName` to the `Consultation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "roomName" TEXT NOT NULL,
ADD COLUMN     "twilioRoomSid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_roomName_key" ON "Consultation"("roomName");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_twilioRoomSid_key" ON "Consultation"("twilioRoomSid");
