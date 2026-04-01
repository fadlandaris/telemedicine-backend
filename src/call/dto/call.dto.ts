import { IsIn, IsOptional, IsString } from 'class-validator';

export class GetCallsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';

  @IsOptional()
  @IsIn(['STARTED', 'CONNECTED', 'RECORDING_READY', 'COMPLETED', 'FAILED'])
  status?: 'STARTED' | 'CONNECTED' | 'RECORDING_READY' | 'COMPLETED' | 'FAILED';
}

export class GetCallStatsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tzOffset?: string;
}
