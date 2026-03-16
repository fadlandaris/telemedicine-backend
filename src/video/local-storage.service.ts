import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

@Injectable()
export class LocalStorageService {
  private uploadsRoot = join(process.cwd(), 'uploads', 'recordings');

  async ensureDir() {
    await fs.mkdir(this.uploadsRoot, { recursive: true });
  }

  async saveFromBuffer(filename: string, buffer: Buffer) {
    await this.ensureDir();

    const filePath = join(this.uploadsRoot, filename);
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  async saveFromStream(filename: string, stream: Readable) {
    await this.ensureDir();

    const filePath = join(this.uploadsRoot, filename);
    await fs.mkdir(dirname(filePath), { recursive: true });

    const writeStream = createWriteStream(filePath);
    await pipeline(stream, writeStream);

    return filePath;
  }

  buildPublicUrl(filename: string) {
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4000';
    return `${baseUrl}/uploads/recordings/${filename}`;
  }
}