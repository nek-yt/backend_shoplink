import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, Auth, CurrentUser } from '../auth/auth.guard';
import { MAX_ID, ORDER_STATUSES } from '../common/constants';
import { ParseIdPipe, type Query as QueryParams, queryEnum, queryNumber, queryPage } from '../common/query';
import { ErrorResponse, OrderPageResponse, OrderResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Auth()
  @ApiOperation({
    summary: 'Place an order',
    description: 'Stock is reserved right away and returned if the order is cancelled. The order keeps today\'s prices.',
  })
  @ApiCreatedResponse({ type: OrderResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Not enough stock' })
  place(@CurrentUser() user: User, @Body() body: CreateOrderDto): Promise<OrderResponse> {
    return this.orders.place(user, body);
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: 'My orders', description: 'Only your own orders, for everyone (admins too). Admins: see /api/orders/all.' })
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@CurrentUser() user: User, @Query() q: QueryParams): Promise<OrderPageResponse> {
    return this.orders.mine(user, { status: queryEnum(q, 'status', ORDER_STATUSES), ...queryPage(q) });
  }

  @Get('all')
  @Admin()
  @ApiOperation({ summary: 'All orders (admin)', description: 'Everyone\'s orders, newest first.' })
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'userId', required: false, type: Number, description: 'Only this customer\'s orders' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  all(@Query() q: QueryParams): Promise<OrderPageResponse> {
    return this.orders.all({
      status: queryEnum(q, 'status', ORDER_STATUSES),
      userId: queryNumber(q, 'userId', { min: 1, max: MAX_ID, integer: true }),
      ...queryPage(q),
    });
  }

  @Get('number/:orderNumber')
  @Auth()
  @ApiOperation({ summary: 'Find an order by its order number', description: 'Your own orders only (admins: any).' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  byNumber(@CurrentUser() user: User, @Param('orderNumber') orderNumber: string): Promise<OrderResponse> {
    return this.orders.getByNumber(user, orderNumber.slice(0, 20));
  }

  @Get('sales')
  @Auth()
  @ApiOperation({
    summary: 'My sales',
    description: 'Orders that include your products. Each order shows only your items, and `total` is for your items only.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  sales(@CurrentUser() user: User, @Query() q: QueryParams): Promise<OrderPageResponse> {
    return this.orders.sales(user, { status: queryEnum(q, 'status', ORDER_STATUSES), ...queryPage(q) });
  }

  @Get('sales/:id')
  @Auth()
  @ApiOperation({ summary: 'One of my sales', description: 'Only your items, and `total` for your items only.' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  sale(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<OrderResponse> {
    return this.orders.sale(user, id);
  }

  @Patch('sales/:id/status')
  @Auth()
  @ApiOperation({
    summary: 'Move one of my sales along',
    description: 'new → confirmed → shipped; new or confirmed → cancelled. The buyer marks it delivered (POST /orders/:id/received). Only when every item in the order is yours (`sellerCanManage`). The buyer is notified.',
  })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'That status change is not allowed' })
  setSaleStatus(
    @CurrentUser() user: User,
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateOrderStatusDto,
  ): Promise<OrderResponse> {
    return this.orders.setSaleStatus(user, id, body.status);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get one order', description: 'Your own orders only (admins: any).' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  get(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<OrderResponse> {
    return this.orders.get(user, id);
  }

  @Post(':id/received')
  @Auth()
  @HttpCode(200)
  @ApiOperation({ summary: 'I got my order', description: 'The buyer marks an order that is on its way (shipped) as delivered. The sellers are notified.' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Order is not on its way' })
  received(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<OrderResponse> {
    return this.orders.received(user, id);
  }

  @Post(':id/cancel')
  @Auth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel your order', description: 'Only while it is still "new".' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Order is no longer new' })
  cancel(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<OrderResponse> {
    return this.orders.cancel(user, id);
  }

  @Patch(':id/status')
  @Admin()
  @ApiOperation({ summary: 'Change order status (admin)', description: 'new → confirmed → shipped → delivered; new or confirmed → cancelled.' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'That status change is not allowed' })
  setStatus(
    @CurrentUser() user: User,
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateOrderStatusDto,
  ): Promise<OrderResponse> {
    return this.orders.setStatus(user, id, body.status);
  }
}
