import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export interface SoapSummaryResult {
  summary: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private readonly model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  private readonly ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not set');
    }

    this.ai = new GoogleGenAI({ apiKey });
  }

  async createMedicalSummary(transcript: string): Promise<SoapSummaryResult> {
    const cleanTranscript = this.normalizeTranscript(transcript);

    if (!cleanTranscript) {
      return {
        summary: 'Transkrip kosong atau tidak terbaca.',
        subjective: 'Keluhan pasien tidak dapat diidentifikasi karena transkrip kosong.',
        objective: 'Tidak ada data objektif yang dapat diekstrak dari transkrip.',
        assessment: 'Tidak dapat membuat assessment karena data tidak cukup.',
        plan: 'Periksa kembali hasil rekaman audio dan proses transkripsi.',
      };
    }

    const prompt = this.buildPrompt(cleanTranscript);

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description:
                  'Ringkasan medis singkat dan padat dari konsultasi.',
              },
              subjective: {
                type: 'string',
                description:
                  'Bagian SOAP Subjective: keluhan, gejala, riwayat yang disampaikan pasien.',
              },
              objective: {
                type: 'string',
                description:
                  'Bagian SOAP Objective: temuan objektif, pemeriksaan, vital sign, observasi. Jika tidak ada, nyatakan tidak disebutkan.',
              },
              assessment: {
                type: 'string',
                description:
                  'Bagian SOAP Assessment: penilaian klinis berdasarkan transkrip. Jangan mengarang diagnosis yang tidak didukung.',
              },
              plan: {
                type: 'string',
                description:
                  'Bagian SOAP Plan: rencana terapi, edukasi, follow-up, instruksi. Jika tidak ada, nyatakan observasi/follow-up sesuai kondisi klinis.',
              },
            },
            required: ['summary', 'subjective', 'objective', 'assessment', 'plan'],
          },
        },
      });

      const rawText = String(response.text || '').trim();

      if (!rawText) {
        throw new Error('Empty Gemini response');
      }

      const parsed = this.safeJsonParse(rawText);

      return {
        summary: this.cleanField(
          parsed.summary,
          'Ringkasan konsultasi tidak berhasil dibuat.',
        ),
        subjective: this.cleanField(
          parsed.subjective,
          'Keluhan subjektif tidak cukup jelas pada transkrip.',
        ),
        objective: this.cleanField(
          parsed.objective,
          'Data objektif tidak disebutkan secara jelas pada transkrip.',
        ),
        assessment: this.cleanField(
          parsed.assessment,
          'Assessment definitif tidak dapat dibuat hanya dari transkrip.',
        ),
        plan: this.cleanField(
          parsed.plan,
          'Lanjutkan observasi gejala, edukasi pasien, dan follow-up sesuai kondisi klinis.',
        ),
      };
    } catch (error: any) {
      this.logger.error(
        `Gemini summary failed model=${this.model} message=${error?.message || error}`,
      );

      throw new InternalServerErrorException(
        `Gemini summary generation failed: ${error?.message || String(error)}`,
      );
    }
  }

  private buildPrompt(transcript: string): string {
      return `
  You are a careful medical scribe assistant for telemedicine consultations.

  Tugas utama:
  Analisis transkrip konsultasi dokter-pasien berikut dan hasilkan output SOAP dalam format JSON yang valid.

  Struktur yang wajib dihasilkan:

  1. summary
  Ringkasan medis singkat, klinis, padat, dan relevan dari hasil konsultasi.

  2. subjective
  Gunakan format SOAP standar untuk S (Subjective), yang berisi informasi dari perspektif pasien:
  - keluhan utama
  - riwayat keluhan
  - durasi
  - faktor pencetus/pereda
  - riwayat penyakit sebelumnya
  - alergi
  - obat yang sedang dikonsumsi
  - informasi tambahan dari pasien

  Tampilkan Subjective SELALU dalam format berikut:
  Keluhan utama:
  Riwayat keluhan:
  Durasi:
  Faktor pencetus/pereda:
  Riwayat penyakit sebelumnya:
  Alergi:
  Obat yang sedang dikonsumsi:
  Informasi tambahan dari pasien:

  Jika ada data yang tidak disebutkan, tulis:
  "Tidak disebutkan dalam transkrip."

  3. objective
  Gunakan format SOAP standar untuk O (Objective), berisi temuan objektif:
  - tanda vital
  - pemeriksaan fisik
  - hasil lab/radiologi
  - observasi lainnya

  Tampilkan Objective SELALU dalam format berikut:
  Tanda vital:
  Pemeriksaan fisik:
  Hasil lab/radiologi:
  Observasi lainnya:

  Jika data objektif tidak tersedia, tulis dengan jelas:
  "Belum ada data objektif yang disampaikan."

  4. assessment
  Gunakan format berikut untuk Assessment:
  Diagnosis kerja:
  1.
  2.

  Diagnosis banding:
  1.
  2.

  ICD-9:
  ICD-10:
  SNOMED:

  Aturan assessment:
  - Buat maksimal dua diagnosis kerja jika memang didukung transkrip.
  - Buat minimal dua diagnosis banding jika memang masuk akal berdasarkan transkrip.
  - Jangan mengarang diagnosis yang tidak didukung data.
  - Jika data tidak cukup, nyatakan dengan jelas bahwa assessment terbatas oleh transkrip.
  - Jika kode ICD-9, ICD-10, atau SNOMED tidak dapat ditentukan dengan yakin dari data yang tersedia, tulis:
  "Tidak dapat ditentukan secara pasti dari transkrip."

  Jika pasien adalah ibu hamil, gunakan format tambahan:
  Gravida Partus Abortus:
  Usia kehamilan:
  Janin tunggal/multiple:
  Janin hidup intra/extra uterin:
  Diagnosis patologis:

  Jika konteks kehamilan tidak disebutkan, jangan dipaksakan.

  5. plan
  Gunakan format SOAP standar untuk P (Plan), berisi rencana tindakan non-preskriptif kecuali dokter memang secara eksplisit memberikan instruksi.

  Tampilkan Plan SELALU dalam format berikut:
  Rencana pemeriksaan lanjutan:
  Edukasi kepada pasien:
  Rekomendasi gaya hidup:
  Tindak lanjut/Follow-up:
  Rencana rawat jalan, rawat inap, atau tindakan:
  Konsultasi kebidang lain jika ada:
  Terapi obat yang diberikan:

  Aturan plan:
  - Tidak memberikan resep obat tanpa instruksi eksplisit dari dokter.
  - Jika suatu bagian tidak disebutkan, tulis:
  "Tidak disebutkan dalam transkrip."

  Important rules:
  - Return valid JSON only.
  - Do not include markdown fences.
  - Do not invent physical exam, vitals, lab results, or diagnosis if they are not supported by the transcript.
  - If objective data is missing, state clearly that objective findings were not explicitly mentioned.
  - If assessment is uncertain, say it is limited by the transcript.
  - Keep the tone clinical, concise, and useful for a consultation note.
  - Preserve the original language of the transcript when reasonable. If the transcript is mixed Indonesian-English, output may also be mixed naturally.

  JSON output schema:
  {
    "summary": "string",
    "subjective": "string",
    "objective": "string",
    "assessment": "string",
    "plan": "string"
  }

  Transcript:
  ${transcript}
    `.trim();
  }

  private normalizeTranscript(text: string): string {
    return String(text || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private safeJsonParse(raw: string): Record<string, any> {
    try {
      return JSON.parse(raw);
    } catch {
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      return JSON.parse(cleaned);
    }
  }

  private cleanField(value: unknown, fallback: string): string {
    const result = String(value ?? '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return result || fallback;
  }
}