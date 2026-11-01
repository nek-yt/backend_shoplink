import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Query, UploadedFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiBadGatewayResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type Query as QueryParams, queryString } from '../common/query';
import { AuthResponse, ErrorResponse, OAuthUrlResponse, UserResponse } from '../common/responses';
import { toUser } from '../common/serializers';
import { ApiError } from '../common/api-error';
import type { User } from '../generated/prisma/client';
import { ImageUpload } from '../images/image-upload';
import { Auth, CurrentUser } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, OAuthCodeDto, RegisterDto, TelegramWebAppDto, TelegramWidgetDto, UpdateMeDto } from './dto/auth.dto';

const OAUTH_STEPS =
  '1. Send the user to `url`. 2. They come back to your redirect URI with `?code=...&state=...`. ' +
  '3. Check that `state` matches, then POST the code to the login endpoint.';

@ApiTags('Auth')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Validation failed' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a customer', description: 'Needs an email or a phone number (or both).' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Email or phone is already registered' })
  @ApiTooManyRequestsResponse({ type: ErrorResponse })
  register(@Body() body: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email or phone and password' })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Wrong login or password' })
  @ApiTooManyRequestsResponse({ type: ErrorResponse })
  login(@Body() body: LoginDto): Promise<AuthResponse> {
    return this.auth.login(body);
  }

  @Post('telegram')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with the Telegram Login Widget', description: 'Send the object the widget gives you, unchanged.' })
  @ApiBody({ type: TelegramWidgetDto })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Invalid or expired Telegram data' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'TELEGRAM_BOT_TOKEN is not set' })
  telegram(@Body() body: Record<string, unknown>): Promise<AuthResponse> {
    return this.auth.loginWithTelegramWidget(body);
  }

  @Post('telegram-webapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in from a Telegram Mini App' })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Invalid or expired Telegram data' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'TELEGRAM_BOT_TOKEN is not set' })
  telegramWebApp(@Body() body: TelegramWebAppDto): Promise<AuthResponse> {
    return this.auth.loginWithTelegramWebApp(body.initData);
  }

  @Get('tiktok/url')
  @ApiOperation({ summary: 'TikTok login: where to send the user', description: OAUTH_STEPS })
  @ApiQuery({ name: 'state', required: false, description: 'Random value you check when the user comes back' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'TikTok login is not configured' })
  tiktokUrl(@Query() q: QueryParams): OAuthUrlResponse {
    return this.auth.oauthUrl('tiktok', queryString(q, 'state'));
  }

  @Post('tiktok')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with TikTok', description: 'Send the `code` from the redirect. Creates the user on first login.' })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Invalid or expired TikTok code' })
  @ApiBadGatewayResponse({ type: ErrorResponse, description: 'TikTok did not answer properly' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'TikTok login is not configured' })
  tiktok(@Body() body: OAuthCodeDto): Promise<AuthResponse> {
    return this.auth.loginWithOAuth('tiktok', body.code);
  }

  @Get('instagram/url')
  @ApiOperation({
    summary: 'Instagram login: where to send the user',
    description: `${OAUTH_STEPS}\n\nOnly professional (Business or Creator) Instagram accounts can log in.`,
  })
  @ApiQuery({ name: 'state', required: false, description: 'Random value you check when the user comes back' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'Instagram login is not configured' })
  instagramUrl(@Query() q: QueryParams): OAuthUrlResponse {
    return this.auth.oauthUrl('instagram', queryString(q, 'state'));
  }

  @Post('instagram')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with Instagram', description: 'Send the `code` from the redirect. Creates the user on first login.' })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Invalid or expired Instagram code' })
  @ApiBadGatewayResponse({ type: ErrorResponse, description: 'Instagram did not answer properly' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'Instagram login is not configured' })
  instagram(@Body() body: OAuthCodeDto): Promise<AuthResponse> {
    return this.auth.loginWithOAuth('instagram', body.code);
  }

  @Get('me')
  @Auth()
  @ApiOperation({ summary: 'The logged-in user' })
  me(@CurrentUser() user: User): UserResponse {
    return toUser(user);
  }

  @Patch('me')
  @Auth()
  @ApiOperation({ summary: 'Update your profile' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'Email or phone is already registered' })
  updateMe(@CurrentUser() user: User, @Body() body: UpdateMeDto): Promise<UserResponse> {
    return this.auth.updateMe(user, body);
  }

  @Put('me/avatar')
  @Auth()
  @ImageUpload()
  @ApiOperation({ summary: 'Upload your profile picture', description: 'Replaces the old one.' })
  setAvatar(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined): Promise<UserResponse> {
    if (!file) throw new ApiError(400, 'Validation failed', ['image file is required (form field "image")']);
    return this.auth.setAvatar(user, file);
  }

  @Delete('me/avatar')
  @Auth()
  @ApiOperation({ summary: 'Remove your profile picture', description: 'You get the default picture (your initials) again.' })
  removeAvatar(@CurrentUser() user: User): Promise<UserResponse> {
    return this.auth.setAvatar(user, null);
  }
}
