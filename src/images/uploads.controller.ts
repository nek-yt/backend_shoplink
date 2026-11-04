import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiError } from '../common/api-error';
import { ErrorResponse } from '../common/responses';
import { UploadsService } from './uploads.service';

// Uploaded pictures (product photos, profile pictures), served from the database.
@ApiTags('Images')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':folder/:name')
  @ApiOperation({ summary: 'An uploaded picture', description: 'The URL is the one saved on the product or user. Names are random and never reused, so it is cached for a long time.' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @ApiOkResponse({ description: 'The picture' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  async get(@Param('folder') folder: string, @Param('name') name: string, @Res() res: Response): Promise<void> {
    const file = await this.uploads.read(folder, name);
    if (!file) throw new ApiError(404, 'Picture not found');
    res
      .status(200)
      .set({ 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' })
      .end(file.data);
  }
}
