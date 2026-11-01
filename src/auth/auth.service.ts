import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { ApiError, validationFailed } from '../common/api-error';
import type { LoginMethod } from '../common/constants';
import type { AuthResponse } from '../common/responses';
import { toUser } from '../common/serializers';
import { normalizePhone } from '../common/validation';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../database/prisma.service';
import { UploadsService } from '../images/uploads.service';
import type { User } from '../generated/prisma/client';
import type { LoginDto, RegisterDto, UpdateMeDto } from './dto/auth.dto';
import { authorizeUrl, fetchProfile, type OAuthApp, type OAuthProvider, PROVIDER_NAMES, type SocialProfile } from './oauth';
import { type TelegramUser, verifyLoginWidget, verifyWebAppInitData } from './telegram';

// Compared against when the user doesn't exist, so response time doesn't reveal which logins are registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly uploads: UploadsService,
  ) {}

  // Every successful register/login goes through here, so it is also where logins are counted.
  // Raw SQL so updated_at (last profile change) is left alone.
  private async authResponse(user: User, method: LoginMethod): Promise<AuthResponse> {
    await this.prisma.$transaction([
      this.prisma.login.create({ data: { userId: user.id, method } }),
      this.prisma.$executeRaw`UPDATE users SET last_login_at = now(), login_count = login_count + 1 WHERE id = ${user.id}`,
    ]);
    return { token: this.jwt.sign({ uid: user.id }), user: toUser(user) };
  }

  private async assertUnique({ email, phone }: { email?: string | null; phone?: string | null }, exceptUserId?: number) {
    const errors: string[] = [];
    const emailOwner = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    const phoneOwner = phone ? await this.prisma.user.findUnique({ where: { phone } }) : null;
    if (emailOwner && emailOwner.id !== exceptUserId) errors.push('email is already registered');
    if (phoneOwner && phoneOwner.id !== exceptUserId) errors.push('phone is already registered');
    if (errors.length) throw new ApiError(409, 'Already registered', errors);
  }

  async register(data: RegisterDto): Promise<AuthResponse> {
    if (!data.email && !data.phone) throw validationFailed('email or phone is required');
    await this.assertUnique(data);
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        passwordHash: await bcrypt.hash(data.password, 10),
        source: data.source,
        socialUsername: data.socialUsername ?? null,
      },
    });
    return this.authResponse(user, 'register');
  }

  async login({ login, password }: LoginDto): Promise<AuthResponse> {
    const user = login.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: login.toLowerCase() } })
      : await this.prisma.user.findUnique({ where: { phone: normalizePhone(login) } });
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    // `errors` names the wrong field so the shop can mark just that input. This reveals whether a login is
    // registered, which /register already does ("email is already registered").
    if (!user || !user.passwordHash) throw new ApiError(401, 'Wrong login or password', ['login is not registered']);
    if (!ok) throw new ApiError(401, 'Wrong login or password', ['password is incorrect']);
    return this.authResponse(user, 'password');
  }

  private requireTelegramToken(): string {
    if (!this.config.telegramBotToken) throw new ApiError(503, 'Telegram login is not configured on the server');
    return this.config.telegramBotToken;
  }

  // Creates the Telegram user, or refreshes their username if it changed. One statement, so two
  // simultaneous first logins can't create the same user twice.
  private async upsertTelegramUser(tg: TelegramUser): Promise<User> {
    const name = (`${tg.firstName} ${tg.lastName}`.trim() || tg.username || 'Telegram user').slice(0, 100);
    const username = tg.username || null;
    await this.prisma.$executeRaw`
      INSERT INTO users (name, source, social_username, telegram_id)
      VALUES (${name}, 'telegram', ${username}, ${BigInt(tg.id)})
      ON CONFLICT (telegram_id) DO UPDATE
        SET social_username = EXCLUDED.social_username, updated_at = now()
        WHERE EXCLUDED.social_username IS NOT NULL
          AND users.social_username IS DISTINCT FROM EXCLUDED.social_username`;
    return this.prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(tg.id) } });
  }

  async loginWithTelegramWidget(data: Record<string, unknown>): Promise<AuthResponse> {
    const token = this.requireTelegramToken();
    const tg = verifyLoginWidget(data, token);
    if (!tg) throw new ApiError(401, 'Invalid or expired Telegram data');
    return this.authResponse(await this.upsertTelegramUser(tg), 'telegram');
  }

  async loginWithTelegramWebApp(initData: string): Promise<AuthResponse> {
    const token = this.requireTelegramToken();
    const tg = verifyWebAppInitData(initData, token);
    if (!tg) throw new ApiError(401, 'Invalid or expired Telegram data');
    return this.authResponse(await this.upsertTelegramUser(tg), 'telegram');
  }

  private oauthApp(provider: OAuthProvider): OAuthApp {
    const app = this.config[provider];
    if (!app) throw new ApiError(503, `${PROVIDER_NAMES[provider]} login is not configured on the server`);
    return app;
  }

  oauthUrl(provider: OAuthProvider, state?: string): { url: string } {
    return { url: authorizeUrl(provider, this.oauthApp(provider), state) };
  }

  async loginWithOAuth(provider: OAuthProvider, code: string): Promise<AuthResponse> {
    const profile = await fetchProfile(provider, this.oauthApp(provider), code);
    return this.authResponse(await this.upsertSocialUser(provider, profile), provider);
  }

  // Like upsertTelegramUser: one statement creates the user or refreshes their username.
  private async upsertSocialUser(provider: OAuthProvider, p: SocialProfile): Promise<User> {
    const name = p.name.slice(0, 100);
    if (provider === 'tiktok') {
      await this.prisma.$executeRaw`
        INSERT INTO users (name, source, social_username, tiktok_id) VALUES (${name}, 'tiktok', ${p.username}, ${p.id})
        ON CONFLICT (tiktok_id) DO UPDATE SET social_username = EXCLUDED.social_username, updated_at = now()
          WHERE EXCLUDED.social_username IS NOT NULL AND users.social_username IS DISTINCT FROM EXCLUDED.social_username`;
      return this.prisma.user.findUniqueOrThrow({ where: { tiktokId: p.id } });
    }
    await this.prisma.$executeRaw`
      INSERT INTO users (name, source, social_username, instagram_id) VALUES (${name}, 'instagram', ${p.username}, ${p.id})
      ON CONFLICT (instagram_id) DO UPDATE SET social_username = EXCLUDED.social_username, updated_at = now()
        WHERE EXCLUDED.social_username IS NOT NULL AND users.social_username IS DISTINCT FROM EXCLUDED.social_username`;
    return this.prisma.user.findUniqueOrThrow({ where: { instagramId: p.id } });
  }

  async updateMe(user: User, data: UpdateMeDto) {
    if (Object.keys(data).length === 0) throw new ApiError(400, 'No fields to update');
    const email = data.email !== undefined ? data.email : user.email;
    const phone = data.phone !== undefined ? data.phone : user.phone;
    if (user.passwordHash && !email && !phone) throw validationFailed('you must keep an email or phone to log in with');
    await this.assertUnique({ email, phone }, user.id);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { ...data } });
    if (data.avatarUrl !== undefined && data.avatarUrl !== user.avatarUrl) await this.uploads.remove(user.avatarUrl);
    return toUser(updated);
  }

  /** Saves a new profile picture (null = back to the default picture) and deletes the old one. */
  async setAvatar(user: User, file: Express.Multer.File | null) {
    const avatarUrl = file ? await this.uploads.saveImage('avatars', file) : null;
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });
    await this.uploads.remove(user.avatarUrl);
    return toUser(updated);
  }
}

/** Creates the admin account on first start if it doesn't exist yet. Returns true if it was created. */
export async function ensureAdmin(prisma: PrismaService, { name, email, password }: AppConfig['admin']): Promise<boolean> {
  if (!email || !password) return false;
  const created = await prisma.user.createMany({
    data: [{ name, email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: 'admin', source: 'other' }],
    skipDuplicates: true,
  });
  return created.count > 0;
}
