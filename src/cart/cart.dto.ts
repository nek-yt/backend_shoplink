import { MAX_ID } from '../common/constants';
import { Check, Optional, rules } from '../common/validation';

const quantity = rules.integer({ min: 1, max: 1000 });

export class AddToCartDto {
  /** @example 1 */
  @Check(rules.integer({ min: 1, max: MAX_ID }))
  productId: number;

  /** Added to what is already in the cart for the same product, size and color. @example 1 */
  @Optional()
  @Check(quantity)
  quantity: number = 1;

  /** Required when the product has sizes. @example M */
  @Optional()
  @Check(rules.text({ min: 1, max: 50 }))
  size?: string;

  /** Required when the product has colors. @example black */
  @Optional()
  @Check(rules.text({ min: 1, max: 50 }))
  color?: string;
}

export class UpdateCartItemDto {
  /** The new quantity (not added to the old one). @example 2 */
  @Check(quantity)
  quantity: number;
}

export class CheckoutDto {
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
}
