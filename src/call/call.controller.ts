import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CallService } from './call.service';
import { GetCallsQueryDto, GetCallStatsQueryDto } from './dto/call.dto';

@Controller('call')
export class CallController {
  constructor(private readonly callService: CallService) {}

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Req() req: any, @Query() query: GetCallsQueryDto) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat melihat history call');
    }
    return this.callService.findAllByDoctor(req.user.id, query);
  }

  @UseGuards(JwtGuard)
  @Get('statistics')
  async getStatistics(@Req() req: any, @Query() query: GetCallStatsQueryDto) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat melihat statistik call');
    }
    return this.callService.getDailyStatistics(req.user.id, query);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat melihat detail call');
    }
    return this.callService.findDetailById(req.user.id, id);
  }
}
