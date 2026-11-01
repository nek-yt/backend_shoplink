import { Check, Optional, rules } from '../common/validation';

const rating = rules.integer({ min: 1, max: 5 });
const comment = rules.text({ max: 2000 });

export class CreateReviewDto {
  /** Stars, 1 to 5. @example 5 */
  @Check(rating)
  rating: number;

  /** @example Great quality, fits perfectly */
  @Optional()
  @Check(comment)
  comment: string = '';
}

/** Send only the fields you want to change. */
export class UpdateReviewDto {
  @Optional()
  @Check(rating)
  rating?: number;

  @Optional()
  @Check(comment)
  comment?: string;
}
