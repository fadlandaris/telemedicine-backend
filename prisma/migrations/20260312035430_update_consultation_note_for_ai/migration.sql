/*
  Warnings:

  - You are about to drop the column `soapJson` on the `ConsultationNote` table. All the data in the column will be lost.
  - You are about to drop the column `transcript` on the `ConsultationNote` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ConsultationNote" DROP COLUMN "soapJson",
DROP COLUMN "transcript",
ADD COLUMN     "aiError" TEXT,
ADD COLUMN     "aiStatus" TEXT,
ADD COLUMN     "assessment" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "subjective" TEXT,
ADD COLUMN     "transcriptRaw" TEXT;
