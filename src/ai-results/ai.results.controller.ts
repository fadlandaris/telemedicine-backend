import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AiResultsService } from './ai-results.service';
import { GetAiResultsQueryDto } from './dto/ai-results.dto';

@Controller('ai-results')
export class AiResultsController {
  constructor(private readonly aiResultsService: AiResultsService) {}

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Req() req: any, @Query() query: GetAiResultsQueryDto) {
    return this.aiResultsService.findAllByDoctor(req.user.id, query);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    return this.aiResultsService.findById(req.user.id, id);
  }
}