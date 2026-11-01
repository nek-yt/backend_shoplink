import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { MAX_ID, MAX_ORDER_ITEMS, ORDER_STATUSES, type OrderStatus } from '../../common/constants';
import { Check, Optional, rules } from '../../common/validation';

export class OrderItemDto {
  /** @example 1 */
  @Check(rules.integer({ min: 1, max: MAX_ID }))
  productId: number;

  /** @example 2 */
  @Check(rules.integer({ min: 1, max: 1000 }))
  quantity: number;

  /** Required when the product has sizes. @example M */
  @Optional()
  @Check(rules.text({ min: 1, max: 50 }))
  size?: string;

  /** Required when the product has colors. @example black */
  @Optional()
  @Check(rules.text({ min: 1, max: 50 }))
  color?: string;
}

export class CreateOrderDto {
  /** Defaults to your profile name. @example Aziza Karimova */
  @Optional()
  @Check(rules.text({ min: 1, max: 100 }))
  customerName?: string;

  /** Defaults to your profile phone. @example +998901234567 */
  @Optional()
  @Check(rules.phone())
  phone?: string;

  /** @example Tashkent, Chilanzar 9, apt 12 */
  @Check(rules.text({ min: 1, max: 500 }))
  address: string;

  /** @example Call before delivery */
  @Optional()
  @Check(rules.text({ max: 1000 }))
  comment?: string;

  @ApiProperty({ type: [OrderItemDto], minItems: 1, maxItems: MAX_ORDER_ITEMS })
  @Check(rules.nonEmptyArray({ max: MAX_ORDER_ITEMS }))
  @ValidateNested({ each: true, message: 'must be an object' })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @Check(rules.oneOf(ORDER_STATUSES))
  status: OrderStatus;
}
