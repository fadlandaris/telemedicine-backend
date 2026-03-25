import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CallService } from './call.service';
import { GetCallsQueryDto } from './dto/call.dto';

@Controller('call')
export class CallController {
  constructor(private readonly callService: CallService) {}

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Req() req: any, @Query() query: GetCallsQueryDto) {
    return this.callService.findAllByDoctor(req.user.id, query);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    return this.callService.findDetailById(req.user.id, id);
  }
}