import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import crypto from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

function hashPassword(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function uniqueIdentity() {
  return `seed_${crypto.randomBytes(10).toString("hex")}`;
}

async function main() {
  console.log("⏳ Start seeding...");

  await prisma.refreshToken.deleteMany();
  await prisma.doctor.deleteMany();

  const fixedDoctors = [
    {
      email: "doctor1@test.com",
      password: "Password123!",
      name: "Dr. Test Satu",
      phone: "081111111111",
      twilioIdentity: "seed_doctor_1",
      isActive: true,
    },
    {
      email: "doctor2@test.com",
      password: "Password123!",
      name: "Dr. Test Dua",
      phone: "082222222222",
      twilioIdentity: "seed_doctor_2",
      isActive: true,
    },
    {
      email: "doctor3@test.com",
      password: "Password123!",
      name: "Dr. Test Tiga",
      phone: "083333333333",
      twilioIdentity: "seed_doctor_3",
      isActive: true,
    },
    {
      email: "doctor4@test.com",
      password: "Password123!",
      name: "Dr. Test Empat",
      phone: "084444444444",
      twilioIdentity: "seed_doctor_4",
      isActive: true,
    },
  ];

  for (const doctor of fixedDoctors) {
    await prisma.doctor.create({
      data: {
        email: doctor.email,
        passwordHash: hashPassword(doctor.password),
        name: doctor.name,
        phone: doctor.phone,
        twilioIdentity: doctor.twilioIdentity,
        isActive: doctor.isActive,
      },
    });
  }

  const count = 100;

  for (let i = 0; i < count; i++) {
    await prisma.doctor.create({
      data: {
        email: faker.internet.email().toLowerCase(),
        passwordHash: hashPassword("Password123!"),
        name: faker.person.fullName(),
        phone: faker.phone.number(),
        twilioIdentity: uniqueIdentity(),
        isActive: true,
      },
    });
  }

  console.log("✅ Seed selesai");
  console.log("✅ 4 akun dummy tetap + 100 faker");
  console.log("1. doctor1@test.com / Password123!");
  console.log("2. doctor2@test.com / Password123!");
  console.log("3. doctor3@test.com / Password123!");
  console.log("4. doctor4@test.com / Password123!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });