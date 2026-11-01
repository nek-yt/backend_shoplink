import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ErrorResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { CommentDto } from './comments.dto';
import { COMMENT_SORTS, type CommentSort, CommentPageResponse, CommentResponse, CommentsService } from './comments.service';

const SORTS = Object.keys(COMMENT_SORTS) as CommentSort[];

@ApiTags('Comments')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@ApiNotFoundResponse({ type: ErrorResponse })
@Controller('products/:productId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOperation({ summary: 'Comments on a product', description: 'Public. Stars are in the reviews; comments are free text, as many as people like.' })
  @ApiQuery({ name: 'sort', required: false, enum: SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@Param('productId', ParseIdPipe) productId: number, @Query() q: QueryParams): Promise<CommentPageResponse> {
    const { page, limit } = queryPage(q);
    return this.comments.list(productId, queryEnum(q, 'sort', SORTS) ?? 'newest', page, limit);
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Comment on a product', description: 'Any logged-in user, as often as they like.' })
  @ApiCreatedResponse({ type: CommentResponse })
  create(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number, @Body() body: CommentDto): Promise<CommentResponse> {
    return this.comments.create(user, productId, body.text);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Change your comment' })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your comment' })
  update(
    @CurrentUser() user: User,
    @Param('productId', ParseIdPipe) productId: number,
    @Param('id', ParseIdPipe) id: number,
    @Body() body: CommentDto,
  ): Promise<CommentResponse> {
    return this.comments.update(user, productId, id, body.text);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment', description: 'Your own; the seller and admins can delete any comment on the product.' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not yours to delete' })
  remove(@CurrentUser() user: User, @Param('productId', ParseIdPipe) productId: number, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.comments.remove(user, productId, id);
  }
}
