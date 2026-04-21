/*
  Warnings:

  - You are about to drop the column `bornDate` on the `PatientProfile` table. All the data in the column will be lost.
  - You are about to drop the column `bornDate` on the `PendingRegistration` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[mrn]` on the table `PatientProfile` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `mrn` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PatientProfile" DROP COLUMN "bornDate",
ADD COLUMN     "mrn" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PendingRegistration" DROP COLUMN "bornDate",
ADD COLUMN     "mrn" TEXT;

-- CreateTable
CREATE TABLE "MrnWhitelist" (
    "id" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrnWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MrnWhitelist_mrn_key" ON "MrnWhitelist"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_mrn_key" ON "PatientProfile"("mrn");
