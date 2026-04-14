/*
  Warnings:

  - You are about to drop the column `mrn` on the `PatientProfile` table. All the data in the column will be lost.
  - You are about to drop the column `mrn` on the `PendingRegistration` table. All the data in the column will be lost.
  - Added the required column `bornDate` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PatientProfile_mrn_key";

-- AlterTable
ALTER TABLE "PatientProfile" DROP COLUMN "mrn",
ADD COLUMN     "bornDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "PendingRegistration" DROP COLUMN "mrn",
ADD COLUMN     "bornDate" TIMESTAMP(3);
