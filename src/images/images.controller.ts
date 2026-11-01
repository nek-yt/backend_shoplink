import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type Query as QueryParams, queryString } from '../common/query';
import { avatarSvg, PRODUCT_SVG } from './images';

// The default pictures. Users and products without their own image point here.
@ApiTags('Images')
@Controller('images')
export class ImagesController {
  @Get('avatar.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Default profile picture', description: 'A colored circle with the initials of `name`.' })
  @ApiQuery({ name: 'name', required: false, example: 'Aziza Karimova' })
  @ApiQuery({ name: 'id', required: false, description: 'Picks the color, so each user keeps theirs' })
  @ApiProduces('image/svg+xml')
  @ApiOkResponse({ description: 'SVG image' })
  avatar(@Query() q: QueryParams): string {
    return avatarSvg((queryString(q, 'name') ?? '').slice(0, 100), (queryString(q, 'id') ?? '').slice(0, 20));
  }

  @Get('product.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Default product picture' })
  @ApiProduces('image/svg+xml')
  @ApiOkResponse({ description: 'SVG image' })
  product(): string {
    return PRODUCT_SVG;
  }
}
