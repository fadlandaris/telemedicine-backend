import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
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
    const fallbackModels = (process.env.WHISPER_MODEL_FALLBACKS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const modelCandidates = [modelName, ...fallbackModels];
    const device = process.env.WHISPER_DEVICE || 'cpu';
    const computeType = process.env.WHISPER_COMPUTE_TYPE || 'int8';

    if (!existsSync(scriptPath)) {
      throw new InternalServerErrorException(
        `Whisper script not found at: ${scriptPath}`,
      );
    }

    let audioInfo = 'unknown';
    if (existsSync(audioPath)) {
      try {
        const stat = statSync(audioPath);
        audioInfo = `${stat.size} bytes`;
      } catch {
        audioInfo = 'exists';
      }
    } else {
      audioInfo = 'missing';
    }

    const execWithModel = async (candidateModel: string) => {
      const { stdout, stderr } = await execFileAsync(
        pythonBin,
        [scriptPath, audioPath, candidateModel, device, computeType],
        {
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
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
    };

    for (let i = 0; i < modelCandidates.length; i++) {
      const candidateModel = modelCandidates[i];
      const isLastAttempt = i === modelCandidates.length - 1;

      try {
        const result = await execWithModel(candidateModel);
        if (candidateModel !== modelName) {
          this.logger.warn(
            `Whisper fallback succeeded: model=${candidateModel}`,
          );
        }
        return result;
      } catch (error: any) {
        const stderr =
          typeof error?.stderr === 'string' ? error.stderr.trim() : '';
        const stdout =
          typeof error?.stdout === 'string' ? error.stdout.trim() : '';
        const code = error?.code ? `code=${error.code}` : '';
        const signal = error?.signal ? `signal=${error.signal}` : '';
        const meta = [code, signal].filter(Boolean).join(' ');

        const baseMessage =
          `Whisper exec failed: python=${pythonBin} script=${scriptPath} ` +
          `model=${candidateModel} device=${device} compute=${computeType} ` +
          `audio=${audioPath} (${audioInfo}) ${meta}`.trim();

        if (isLastAttempt) {
          this.logger.error(baseMessage);
          if (stderr) {
            this.logger.error(`[faster-whisper stderr] ${stderr}`);
          }
          if (stdout) {
            this.logger.error(`[faster-whisper stdout] ${stdout}`);
          }

          throw new InternalServerErrorException(
            `Whisper transcription failed: ${error?.message || String(error)}${
              meta ? ` (${meta})` : ''
            }${
              stderr ? `\n${stderr}` : ''
            }${stdout ? `\n${stdout}` : ''}`,
          );
        }

        this.logger.warn(baseMessage);
        if (stderr) {
          this.logger.warn(`[faster-whisper stderr] ${stderr}`);
        }
        if (stdout) {
          this.logger.warn(`[faster-whisper stdout] ${stdout}`);
        }
        this.logger.warn(
          `Whisper fallback: trying next model=${modelCandidates[i + 1]}`,
        );
      }
    }

    throw new InternalServerErrorException(
      'Whisper transcription failed: no model candidates available.',
    );
  }
}
