/*
  Warnings:

  - You are about to drop the column `email` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `DoctorProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `DoctorProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `PatientProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `PatientProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `StaffProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `StaffProfile` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `email` to the `DoctorProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `DoctorProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `DoctorProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `StaffProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `StaffProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `StaffProfile` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "User_phone_key";

-- AlterTable
ALTER TABLE "DoctorProfile" ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phone" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phone" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phone" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email",
DROP COLUMN "passwordHash",
DROP COLUMN "phone";

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_email_key" ON "DoctorProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_phone_key" ON "DoctorProfile"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_email_key" ON "PatientProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_phone_key" ON "PatientProfile"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_email_key" ON "StaffProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_phone_key" ON "StaffProfile"("phone");
