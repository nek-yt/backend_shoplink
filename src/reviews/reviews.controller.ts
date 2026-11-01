import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, CurrentUser } from '../auth/auth.guard';
import { ParseIdPipe, type Query as QueryParams, queryEnum, queryPage } from '../common/query';
import { ErrorResponse, ReviewPageResponse, ReviewResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { CreateReviewDto, UpdateReviewDto } from './reviews.dto';
import { REVIEW_SORTS, type ReviewSort, ReviewsService } from './reviews.service';

const SORTS = Object.keys(REVIEW_SORTS) as ReviewSort[];

@ApiTags('Reviews')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@ApiNotFoundResponse({ type: ErrorResponse })
@Controller('products/:productId/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Reviews of a product', description: 'The count and average stars are on the product (reviewsCount, reviewsRating).' })
  @ApiQuery({ name: 'sort', required: false, enum: SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@Param('productId', ParseIdPipe) productId: number, @Query() q: QueryParams): Promise<ReviewPageResponse> {
    const { page, limit } = queryPage(q);
    return this.reviews.list(productId, queryEnum(q, 'sort', SORTS) ?? 'newest', page, limit);
  }

  @Get('mine')
  @Auth()
  @ApiOperation({ summary: 'My review of this product', description: '404 if you have not reviewed it.' })
  mine(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number): Promise<ReviewResponse> {
    return this.reviews.mine(user, productId);
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Review a product', description: 'Stars 1 to 5 and an optional comment. One review per product; you cannot review your own.' })
  @ApiCreatedResponse({ type: ReviewResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Your own product' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'You already reviewed it' })
  create(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number, @Body() body: CreateReviewDto): Promise<ReviewResponse> {
    return this.reviews.create(user, productId, body);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Change your review' })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your review' })
  update(
    @CurrentUser() user: User,
    @Param('productId', ParseIdPipe) productId: number,
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateReviewDto,
  ): Promise<ReviewResponse> {
    return this.reviews.update(user, productId, id, body);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete your review', description: 'Admins can delete any review.' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your review' })
  remove(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.reviews.remove(user, productId, id);
  }
}
