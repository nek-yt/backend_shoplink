import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, CurrentUser } from '../auth/auth.guard';
import { ParseIdPipe } from '../common/query';
import { CartItemResponse, CartResponse, ErrorResponse, OrderResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { AddToCartDto, CheckoutDto, UpdateCartItemDto } from './cart.dto';
import { CartService } from './cart.service';

@ApiTags('Cart')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@Auth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'My cart', description: 'With today\'s prices, the total, and whether each line is still in stock.' })
  get(@CurrentUser() user: User): Promise<CartResponse> {
    return this.cart.get(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One cart item' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  getItem(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<CartItemResponse> {
    return this.cart.getItem(user, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add to cart',
    description: 'The same product with the same size and color is added to the existing line.',
  })
  @ApiCreatedResponse({ type: CartItemResponse })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'Product not found' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Not enough stock, or the cart is full' })
  add(@CurrentUser() user: User, @Body() body: AddToCartDto): Promise<CartItemResponse> {
    return this.cart.add(user, body);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Order everything in my cart', description: 'Places one order and empties the cart.' })
  @ApiCreatedResponse({ type: OrderResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Not enough stock' })
  checkout(@CurrentUser() user: User, @Body() body: CheckoutDto): Promise<OrderResponse> {
    return this.cart.checkout(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the quantity of a cart item' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Not enough stock' })
  update(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number, @Body() body: UpdateCartItemDto): Promise<CartItemResponse> {
    return this.cart.setQuantity(user, id, body.quantity);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a cart item' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  remove(@CurrentUser() user: User, @Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.cart.remove(user, id);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Empty my cart' })
  @ApiNoContentResponse({ description: 'Emptied' })
  clear(@CurrentUser() user: User): Promise<void> {
    return this.cart.clear(user);
  }
}
