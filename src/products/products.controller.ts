import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UploadedFile, UploadedFiles } from '@nestjs/common';
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
import { ApiError } from '../common/api-error';
import { CATEGORIES, MAX_ID } from '../common/constants';
import { ParseIdPipe, type Query as QueryParams, queryBoolean, queryEnum, queryNumber, queryPage, queryString } from '../common/query';
import { ErrorResponse, ProductPageResponse, ProductResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { ImagesUpload, ImageUpload } from '../images/image-upload';
import { MAX_PRODUCT_IMAGES } from '../images/images';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { PRODUCT_SORTS, type ProductSort, ProductsService } from './products.service';

const SORTS = Object.keys(PRODUCT_SORTS) as ProductSort[];

function filters(q: QueryParams) {
  return {
    search: queryString(q, 'search'),
    minPrice: queryNumber(q, 'minPrice', { min: 0 }),
    maxPrice: queryNumber(q, 'maxPrice', { min: 0 }),
    minRating: queryNumber(q, 'minRating', { min: 0, max: 5 }),
    size: queryString(q, 'size'),
    color: queryString(q, 'color'),
    category: queryEnum(q, 'category', CATEGORIES),
    inStock: queryBoolean(q, 'inStock'),
    sort: queryEnum(q, 'sort', SORTS) ?? 'newest',
    ...queryPage(q),
  };
}

@ApiTags('Products')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products', description: 'Search, filter, sort and page through the catalog.' })
  @ApiQuery({ name: 'search', required: false, description: 'Text in the name or description' })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'minRating', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, example: 'M' })
  @ApiQuery({ name: 'color', required: false, example: 'black' })
  @ApiQuery({ name: 'category', required: false, enum: CATEGORIES })
  @ApiQuery({ name: 'inStock', required: false, type: Boolean })
  @ApiQuery({ name: 'sellerId', required: false, type: Number, description: "Only this seller's products" })
  @ApiQuery({ name: 'sort', required: false, enum: SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@Query() q: QueryParams): Promise<ProductPageResponse> {
    return this.products.list({ ...filters(q), sellerId: queryNumber(q, 'sellerId', { min: 1, max: MAX_ID, integer: true }) });
  }

  @Get('mine')
  @Auth()
  @ApiOperation({ summary: 'My products', description: 'The products you sell. Same filters as the catalog.' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'inStock', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false, enum: SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  mine(@CurrentUser() user: User, @Query() q: QueryParams): Promise<ProductPageResponse> {
    return this.products.list({ ...filters(q), sellerId: user.id });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one product' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  get(@Param('id', ParseIdPipe) id: number): Promise<ProductResponse> {
    return this.products.get(id);
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Sell a product', description: 'Any logged-in user can. You become its seller.' })
  @ApiCreatedResponse({ type: ProductResponse })
  create(@CurrentUser() user: User, @Body() body: CreateProductDto): Promise<ProductResponse> {
    return this.products.create(user, body);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Update your product', description: 'Admins can update any product.' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  update(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number, @Body() body: UpdateProductDto): Promise<ProductResponse> {
    return this.products.update(user, id, body);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete your product',
    description: 'Admins can delete any product. Past orders keep their copy of the name and price.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  remove(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.products.remove(user, id);
  }

  @Put(':id/image')
  @Auth()
  @ImageUpload()
  @ApiOperation({ summary: 'Upload the product picture', description: 'Replaces the old one. Your products only (admins: any).' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  setImage(
    @CurrentUser() user: User,
    @Param('id', ParseIdPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProductResponse> {
    if (!file) throw new ApiError(400, 'Validation failed', ['image file is required (form field "image")']);
    return this.products.setImage(user, id, file);
  }

  @Delete(':id/image')
  @Auth()
  @ApiOperation({ summary: 'Remove the product picture', description: 'The product gets the default "No image" picture again.' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  removeImage(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<ProductResponse> {
    return this.products.setImage(user, id, null);
  }

  @Post(':id/images')
  @Auth()
  @ImagesUpload()
  @ApiOperation({
    summary: 'Add more pictures',
    description: `Adds 1 to ${MAX_PRODUCT_IMAGES} pictures to \`images\` (the main picture stays in \`imageUrl\`). At most ${MAX_PRODUCT_IMAGES} in total. Your products only (admins: any).`,
  })
  @ApiCreatedResponse({ type: ProductResponse })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  addImages(
    @CurrentUser() user: User,
    @Param('id', ParseIdPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<ProductResponse> {
    if (!files?.length) throw new ApiError(400, 'Validation failed', ['at least one image file is required (form field "images")']);
    return this.products.addImages(user, id, files);
  }

  @Delete(':id/images/:name')
  @Auth()
  @ApiOperation({ summary: 'Remove one of the extra pictures', description: '`name` is the last part of its URL, e.g. 9c1d….jpg' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Not your product' })
  removeExtraImage(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number, @Param('name') name: string): Promise<ProductResponse> {
    return this.products.removeImage(user, id, name);
  }
}
