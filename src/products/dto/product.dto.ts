import { ApiProperty } from '@nestjs/swagger';
import { CATEGORIES, type Category, MAX_PRICE } from '../../common/constants';
import { Check, Nullable, Optional, rules } from '../../common/validation';

const name = rules.text({ min: 1, max: 200 });
const description = rules.text({ max: 5000 });
const price = rules.number({ min: 0, max: MAX_PRICE, decimals: 2 });
const rating = rules.number({ min: 0, max: 5, decimals: 2 });
const stock = rules.integer({ min: 0, max: 1_000_000 });
const options = rules.stringList();
const imageUrl = rules.url();
const category = rules.oneOf(CATEGORIES);

export class CreateProductDto {
  /** @example Oversize Hoodie */
  @Check(name)
  name: string;

  /** @example Warm cotton hoodie with a kangaroo pocket */
  @Optional()
  @Check(description)
  description: string = '';

  /** Up to 2 decimal places. @example 249000 */
  @Check(price)
  price: number;

  /** 0 to 5. @example 4.7 */
  @Optional()
  @Check(rating)
  rating: number = 0;

  /** How many are in stock. @example 25 */
  @Check(stock)
  stock: number;

  /** @example ["S", "M", "L", "XL"] */
  @Optional()
  @Check(options)
  sizes: string[] = [];

  /** @example ["black", "beige"] */
  @Optional()
  @Check(options)
  colors: string[] = [];

  /** What it is, for browsing by category. */
  @ApiProperty({ enum: CATEGORIES, default: 'other', required: false })
  @Optional()
  @Check(category)
  category: Category = 'other';

  /** @example https://example.com/hoodie.jpg */
  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(imageUrl)
  imageUrl: string | null = null;
}

/** Send only the fields you want to change. */
export class UpdateProductDto {
  @Optional()
  @Check(name)
  name?: string;

  @Optional()
  @Check(description)
  description?: string;

  @Optional()
  @Check(price)
  price?: number;

  @Optional()
  @Check(rating)
  rating?: number;

  @Optional()
  @Check(stock)
  stock?: number;

  @Optional()
  @Check(options)
  sizes?: string[];

  @Optional()
  @Check(options)
  colors?: string[];

  @ApiProperty({ enum: CATEGORIES, required: false })
  @Optional()
  @Check(category)
  category?: Category;

  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(imageUrl)
  imageUrl?: string | null;
}
