import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import crypto from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

// dummy hash (cukup untuk testing login)
function hashPassword(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function uniqueIdentity() {
  return `seed_${crypto.randomBytes(10).toString("hex")}`;
}

async function main() {
  // bersihin data auth dulu
  await prisma.refreshToken.deleteMany();
  await prisma.doctor.deleteMany();

  // ===== akun tetap (buat test login manual) =====
  await prisma.doctor.create({
    data: {
      email: "doctor@test.com",
      passwordHash: hashPassword("Password123!"),
      name: "Dr. Test Account",
      phone: "081234567890",
      twilioIdentity: "seed_doctor_test",
      isActive: true,
    },
  });

  // ===== 100 akun faker =====
  const count = 100;

  for (let i = 0; i < count; i++) {
    await prisma.doctor.create({
      data: {
        email: faker.internet.email().toLowerCase(),
        passwordHash: hashPassword("Password123!"),
        name: faker.person.fullName(),
        phone: faker.phone.number(),
        twilioIdentity: uniqueIdentity(), // wajib unik
        isActive: true,
      },
    });
  }

  console.log(`✅ Seed selesai`);
  console.log(`✅ 1 akun test + ${count} akun faker`);
  console.log(`✅ Login test: doctor@test.com / Password123!`);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
