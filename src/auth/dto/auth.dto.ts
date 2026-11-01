import { ApiProperty } from '@nestjs/swagger';
import { SOURCES, type Source } from '../../common/constants';
import { Check, Nullable, Optional, rules } from '../../common/validation';

export class RegisterDto {
  /** @example Aziza Karimova */
  @Check(rules.text({ min: 1, max: 100 }))
  name: string;

  /** At least 8 characters. @example password123 */
  @Check(rules.password())
  password: string;

  /** Email or phone (or both) is required. @example aziza@example.com */
  @Optional()
  @Check(rules.email())
  email?: string;

  /** @example +998901234567 */
  @Optional()
  @Check(rules.phone())
  phone?: string;

  /** Where the customer came from. */
  @ApiProperty({ enum: SOURCES, default: 'other', required: false })
  @Optional()
  @Check(rules.oneOf(SOURCES))
  source: Source = 'other';

  /** Their username on that platform, without "@". @example aziza.style */
  @Optional()
  @Check(rules.username())
  socialUsername?: string;
}

export class LoginDto {
  /** Email or phone number. @example admin@shoplink.com */
  @Check(rules.text({ min: 1, max: 254 }))
  login: string;

  /** @example admin12345 */
  @Check(rules.text({ min: 1, max: 200, trim: false }))
  password: string;
}

export class TelegramWebAppDto {
  /** `Telegram.WebApp.initData` from the Mini App, as is. */
  @Check(rules.text({ min: 1, max: 10000 }))
  initData: string;
}

export class OAuthCodeDto {
  /** The `code` from the redirect back to your site (after you checked `state`). */
  @Check(rules.text({ min: 1, max: 2000 }))
  code: string;
}

/** Data from the Telegram Login Widget, passed through unchanged (it is signed by Telegram). */
export class TelegramWidgetDto {
  /** @example 123456789 */
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  /** Unix time. */
  auth_date: number;
  hash: string;
}

export class UpdateMeDto {
  @Optional()
  @Check(rules.text({ min: 1, max: 100 }))
  name?: string;

  /** null removes it (you must keep an email or a phone to log in with). */
  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(rules.email())
  email?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(rules.phone())
  phone?: string | null;

  @ApiProperty({ enum: SOURCES, required: false })
  @Optional()
  @Check(rules.oneOf(SOURCES))
  source?: Source;

  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(rules.username())
  socialUsername?: string | null;

  /** A link to a picture on another site. To upload a file use PUT /api/auth/me/avatar. null brings back the default. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @Nullable()
  @Check(rules.url())
  avatarUrl?: string | null;
}
