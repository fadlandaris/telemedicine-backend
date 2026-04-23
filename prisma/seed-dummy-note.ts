import 'dotenv/config';
import { PrismaClient, SessionType, ConsultationMode, SessionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DOCTOR_ID  = 'd1c5c5cc-878d-4e8b-83e5-f1f42a792449';
const PATIENT_ID = '2c11075d-33d4-45a3-8b01-e373092ce249';

const SESSION_ID = 'dummy-session-fadlan-pasien1-2026';
const ROOM_NAME  = 'room-dummy-fadlan-pasien1';

async function main() {
  // Pastikan session belum ada
  const existing = await prisma.consultationSession.findUnique({ where: { sessionId: SESSION_ID } });
  if (existing) {
    console.log('⚠️  Dummy session sudah ada, skip insert session.');
  } else {
    await prisma.consultationSession.create({
      data: {
        sessionId:          SESSION_ID,
        patientId:          PATIENT_ID,
        doctorId:           DOCTOR_ID,
        createdBy:          DOCTOR_ID,
        sessionType:        SessionType.SCHEDULED,
        consultationMode:   ConsultationMode.VIDEO,
        scheduledDate:      new Date('2026-04-22T00:00:00.000Z'),
        scheduledStartTime: new Date('2026-04-22T09:00:00.000Z'),
        scheduledEndTime:   new Date('2026-04-22T09:30:00.000Z'),
        durationMinutes:    30,
        sessionStatus:      SessionStatus.COMPLETED,
        roomName:           ROOM_NAME,
        doctorIdentity:     'doctor-fadlan',
        patientIdentity:    'patient-pasien1',
        patientName:        'Pasien 1',
        doctorJoinedAt:     new Date('2026-04-22T09:00:45.000Z'),
        patientJoinedAt:    new Date('2026-04-22T09:01:10.000Z'),
        startedAt:          new Date('2026-04-22T09:01:10.000Z'),
        endedAt:            new Date('2026-04-22T09:28:52.000Z'),
      },
    });
    console.log('✅ Dummy ConsultationSession berhasil dibuat.');
  }

  // Hapus note lama kalau ada, lalu insert ulang
  await prisma.consultationNote.deleteMany({
    where: { consultationSessionId: SESSION_ID },
  });

  await prisma.consultationNote.create({
    data: {
      consultationSessionId: SESSION_ID,
      doctorId:              DOCTOR_ID,
      patientId:             PATIENT_ID,

      transcriptRaw: `[00:00] Dokter: Selamat pagi, ada yang bisa saya bantu hari ini?
[00:05] Pasien: Selamat pagi, Dokter. Saya sudah beberapa hari ini merasakan sakit kepala terus-menerus, terutama di bagian belakang kepala. Kadang sampai terasa berat.
[00:18] Dokter: Baik, sakit kepalanya seperti apa? Berdenyut atau terasa tertekan?
[00:24] Pasien: Lebih ke terasa tertekan, Dokter. Kadang juga ada rasa pusing kalau berdiri terlalu cepat.
[00:33] Dokter: Apakah ada mual atau muntah yang menyertai?
[00:38] Pasien: Tidak ada muntah, tapi kadang sedikit mual.
[00:44] Dokter: Sudah berapa lama keluhan ini berlangsung?
[00:48] Pasien: Kira-kira 4 hari ini, Dokter.
[00:52] Dokter: Apakah Anda punya riwayat tekanan darah tinggi sebelumnya?
[00:58] Pasien: Belum pernah diperiksa, Dokter. Tapi ibu saya memang punya hipertensi.
[01:05] Dokter: Baik. Bagaimana pola makan dan istirahat Anda belakangan ini?
[01:11] Pasien: Saya akui kurang tidur belakangan ini, Dokter. Kerja sampai larut malam. Makanan juga sering yang asin-asin karena pesan makanan terus.
[01:22] Dokter: Saya mengerti. Apakah Anda merokok atau minum alkohol?
[01:27] Pasien: Tidak, Dokter.
[01:30] Dokter: Baik, berdasarkan gejala yang Anda ceritakan — sakit kepala bagian belakang, rasa tertekan, pusing saat berdiri, ditambah riwayat keluarga hipertensi — saya menduga ini berhubungan dengan tekanan darah. Saya sarankan Anda periksa tekanan darah secepatnya di fasilitas kesehatan terdekat ya.
[01:50] Pasien: Baik Dokter, apakah perlu minum obat sekarang?
[01:55] Dokter: Untuk saat ini saya akan berikan obat pereda sakit kepala ringan dan suplemen magnesium. Namun yang paling penting, Anda harus kurangi konsumsi garam, cukupkan istirahat minimal 7-8 jam, dan segera cek tensi. Jika tekanan darah di atas 140/90, segera ke dokter langsung.
[02:14] Pasien: Siap Dokter, terima kasih banyak.
[02:17] Dokter: Sama-sama. Semoga cepat pulih. Jangan lupa kontrol ya kalau keluhan tidak membaik dalam 2-3 hari.`,

      summary: `Pasien perempuan usia 23 tahun datang dengan keluhan sakit kepala terus-menerus selama 4 hari, terutama di bagian belakang kepala, bersifat menekan dan disertai pusing saat berdiri serta sedikit mual. Tidak ada riwayat hipertensi pribadi namun ibu kandung menderita hipertensi. Pasien mengaku kurang tidur dan sering mengonsumsi makanan tinggi garam. Dokter menduga keluhan berkaitan dengan tekanan darah tinggi dan merekomendasikan pemeriksaan tensi segera. Diberikan terapi simtomatik berupa analgesik ringan dan suplemen magnesium, serta edukasi modifikasi gaya hidup.`,

      subjective: `Pasien mengeluhkan sakit kepala selama 4 hari, terasa menekan terutama di area oksipital (belakang kepala). Disertai pusing ortostatik (terutama saat berdiri tiba-tiba) dan mual ringan tanpa muntah. Riwayat keluarga: ibu kandung menderita hipertensi. Pola tidur terganggu (kurang tidur karena pekerjaan hingga larut malam). Diet tinggi natrium (sering konsumsi makanan siap saji). Tidak merokok, tidak mengonsumsi alkohol.`,

      objective: `Konsultasi dilakukan melalui video call. Pemeriksaan fisik tidak dapat dilakukan secara langsung. Pasien tampak sadar penuh dan komunikatif. Tidak ditemukan tanda-tanda kegawatdaruratan neurologis dari anamnesis. Riwayat tekanan darah belum pernah diukur sebelumnya. Tidak ada riwayat penyakit kronis yang diketahui.`,

      assessment: `1. Suspect Hipertensi Stadium I — berdasarkan gejala sakit kepala oksipital menekan, pusing ortostatik, riwayat keluarga hipertensi, dan faktor risiko diet tinggi garam serta kurang tidur.
2. Cephalgia tipe tension (tension-type headache) — perlu disingkirkan atau dikonfirmasi setelah pengukuran tekanan darah.
3. Deprivasi tidur sebagai faktor kontribusi.`,

      plan: `1. Periksa tekanan darah di fasilitas kesehatan terdekat secepatnya. Jika TD ≥ 140/90 mmHg, konsultasi langsung ke dokter.
2. Medikasi: Parasetamol 500 mg 3x1 jika nyeri (maksimal 3 hari), Magnesium glycinate 200 mg 1x1 malam.
3. Modifikasi gaya hidup: batasi asupan garam (<5 g/hari), perbaiki pola tidur (minimal 7-8 jam/malam), hindari stres berlebih.
4. Kontrol ulang dalam 2-3 hari jika keluhan tidak membaik, atau segera jika muncul nyeri kepala hebat tiba-tiba, gangguan penglihatan, atau kelemahan anggota gerak.`,

      aiStatus:     'SUCCESS',
      aiModel:      'claude-sonnet-4-6',
      transcribedAt: new Date('2026-04-22T09:30:10.000Z'),
      summarizedAt:  new Date('2026-04-22T09:30:25.000Z'),
      isFinalized:   true,
      finalizedAt:   new Date('2026-04-22T09:35:00.000Z'),
    },
  });

  console.log('✅ Dummy ConsultationNote berhasil dibuat.');
  console.log(`   Session ID : ${SESSION_ID}`);
  console.log(`   Doctor ID  : ${DOCTOR_ID}`);
  console.log(`   Patient ID : ${PATIENT_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
