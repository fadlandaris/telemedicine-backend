import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve } from 'path';

const execFileAsync = promisify(execFile);

export interface TranscriptionSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  async transcribeWithWhisper(audioPath: string): Promise<TranscriptionResult> {
    const venvPython = '/opt/venv/bin/python';
    const envPython = process.env.WHISPER_PYTHON_BIN;
    const pythonBin = existsSync(venvPython)
      ? venvPython
      : (envPython && existsSync(envPython) && envPython) || 'python';
    const scriptPath =
      process.env.WHISPER_SCRIPT_PATH ||
      resolve(process.cwd(), 'scripts', 'transcribe.py');

    const modelName = process.env.WHISPER_MODEL || 'small';
    const device = process.env.WHISPER_DEVICE || 'cpu';
    const computeType = process.env.WHISPER_COMPUTE_TYPE || 'int8';

    if (!existsSync(scriptPath)) {
      throw new InternalServerErrorException(
        `Whisper script not found at: ${scriptPath}`,
      );
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        pythonBin,
        [scriptPath, audioPath, modelName, device, computeType],
        {
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (stderr?.trim()) {
        this.logger.warn(`[faster-whisper stderr] ${stderr}`);
      }

      const parsed = JSON.parse(stdout);

      if (parsed?.error) {
        throw new Error(parsed.error);
      }

      return {
        text: String(parsed?.text || '').trim(),
        language: parsed?.language || undefined,
        duration:
          typeof parsed?.duration === 'number' ? parsed.duration : undefined,
        segments: Array.isArray(parsed?.segments) ? parsed.segments : [],
      };
    } catch (error: any) {
      const stderr =
        typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      const stdout =
        typeof error?.stdout === 'string' ? error.stdout.trim() : '';

      throw new InternalServerErrorException(
        `Whisper transcription failed: ${error?.message || String(error)}${
          stderr ? `\n${stderr}` : ''
        }${stdout ? `\n${stdout}` : ''}`,
      );
    }
  }
}
