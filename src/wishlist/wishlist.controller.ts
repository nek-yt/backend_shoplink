import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, CurrentUser } from '../auth/auth.guard';
import { ParseIdPipe, type Query as QueryParams, queryPage } from '../common/query';
import { ErrorResponse, WishlistItemResponse, WishlistPageResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { AddToWishlistDto } from './wishlist.dto';
import { WishlistService } from './wishlist.service';

@ApiTags('Wishlist')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@Auth()
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({ summary: 'My wishlist', description: 'Newest first.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@CurrentUser() user: User, @Query() q: QueryParams): Promise<WishlistPageResponse> {
    const { page, limit } = queryPage(q);
    return this.wishlist.list(user, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One wishlist item' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  get(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<WishlistItemResponse> {
    return this.wishlist.get(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a product to my wishlist', description: 'If it is already there, you get the existing item back.' })
  @ApiCreatedResponse({ type: WishlistItemResponse })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'Product not found' })
  add(@CurrentUser() user: User, @Body() body: AddToWishlistDto): Promise<WishlistItemResponse> {
    return this.wishlist.add(user, body.productId);
  }

  @Delete('product/:productId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a product from my wishlist (by product id)' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  removeProduct(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number): Promise<void> {
    return this.wishlist.removeProduct(user, productId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a wishlist item (by wishlist item id)' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  remove(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.wishlist.remove(user, id);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Empty my wishlist' })
  @ApiNoContentResponse({ description: 'Emptied' })
  clear(@CurrentUser() user: User): Promise<void> {
    return this.wishlist.clear(user);
  }
}
