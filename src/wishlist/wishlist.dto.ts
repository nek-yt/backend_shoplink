import { MAX_ID } from '../common/constants';
import { Check, rules } from '../common/validation';

export class AddToWishlistDto {
  /** @example 1 */
  @Check(rules.integer({ min: 1, max: MAX_ID }))
  productId: number;
}
