import { ConsultationMode, SessionStatus, SessionType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateConsultationSessionDto {
  @IsUUID()
  doctorId: string;

  @IsUUID()
  patientId: string;

  @IsEnum(SessionType)
  sessionType: SessionType;

  @IsEnum(ConsultationMode)
  consultationMode: ConsultationMode;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'scheduledDate harus format YYYY-MM-DD',
  })
  scheduledDate?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, {
    message: 'scheduledStartTime harus format HH:mm',
  })
  scheduledStartTime?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, {
    message: 'scheduledEndTime harus format HH:mm',
  })
  scheduledEndTime?: string;
}

export class ListConsultationSessionsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus format YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';

  @IsOptional()
  @IsString()
  search?: string;
}

