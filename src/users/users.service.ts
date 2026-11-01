import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { LOGIN_METHODS, type LoginMethod, SOURCES, type Source } from '../common/constants';
import { paginate } from '../common/query';
import type {
  AdminUserDetailResponse,
  AdminUserPageResponse,
  LoginPageResponse,
  LoginResponse,
  UserStatsResponse,
} from '../common/responses';
import { toAdminUser, toLogin } from '../common/serializers';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';

export const USER_SORTS = ['newest', 'oldest', 'lastLogin', 'mostLogins', 'name'] as const;
export type UserSort = (typeof USER_SORTS)[number];

const ORDER_BY: Record<UserSort, Prisma.UserOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  lastLogin: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
  mostLogins: [{ loginCount: 'desc' }, { id: 'desc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
};

const withOrderCount = { _count: { select: { orders: true } } } as const;
const withUserName = { user: { select: { name: true } } } as const;

export interface UserFilters {
  search?: string;
  source?: Source;
  role?: 'customer' | 'admin';
  sort: UserSort;
  page: number;
  limit: number;
}

export interface LoginFilters {
  userId?: number;
  method?: LoginMethod;
  page: number;
  limit: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list({ search, source, role, sort, page, limit }: UserFilters): Promise<AdminUserPageResponse> {
    const where: Prisma.UserWhereInput = { source, role };
    if (search) {
      // Same ICU case folding as the product search, so Cyrillic names match in any case.
      const term = Prisma.sql`lower(${search}::text COLLATE "und-x-icu")`;
      const digits = search.replace(/\D/g, ''); // "90 111-22" finds +998901112233
      const matches = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM users
        WHERE strpos(lower(name COLLATE "und-x-icu"), ${term}) > 0
           OR strpos(lower(coalesce(email, '') COLLATE "und-x-icu"), ${term}) > 0
           OR (${digits}::text <> '' AND strpos(coalesce(phone, ''), ${digits}::text) > 0)
           OR strpos(lower(coalesce(social_username, '') COLLATE "und-x-icu"), ${term}) > 0`;
      where.id = { in: matches.map((m) => m.id) };
    }
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: ORDER_BY[sort], skip: (page - 1) * limit, take: limit, include: withOrderCount }),
    ]);
    return { items: users.map(toAdminUser), ...paginate(total, page, limit) };
  }

  async get(id: number): Promise<AdminUserDetailResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { ...withOrderCount, logins: { orderBy: { id: 'desc' }, take: 20, include: withUserName } },
    });
    if (!user) throw new ApiError(404, 'User not found');
    return { ...toAdminUser(user), recentLogins: user.logins.map(toLogin) };
  }

  async logins({ userId, method, page, limit }: LoginFilters): Promise<LoginPageResponse> {
    const where: Prisma.LoginWhereInput = { userId, method };
    const [total, logins] = await Promise.all([
      this.prisma.login.count({ where }),
      this.prisma.login.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: withUserName }),
    ]);
    return { items: logins.map(toLogin), ...paginate(total, page, limit) };
  }

  async login(id: number): Promise<LoginResponse> {
    const login = await this.prisma.login.findUnique({ where: { id }, include: withUserName });
    if (!login) throw new ApiError(404, 'Login not found');
    return toLogin(login);
  }

  async stats(days: number): Promise<UserStatsResponse> {
    const tz = this.config.statsTimeZone;
    // Start of today, 6 days ago and 29 days ago in the stats time zone.
    const bounds = Prisma.sql`
      SELECT (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS d0,
             (date_trunc('day', now() AT TIME ZONE ${tz}) - interval '6 days') AT TIME ZONE ${tz} AS d6,
             (date_trunc('day', now() AT TIME ZONE ${tz}) - interval '29 days') AT TIME ZONE ${tz} AS d29`;

    const [[users], [logins], bySource, byMethod, daily] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number>[]>`
        WITH b AS (${bounds})
        SELECT count(u.id)::int AS total,
               count(u.id) FILTER (WHERE u.role = 'admin')::int AS admins,
               count(u.id) FILTER (WHERE u.created_at >= b.d0)::int AS "regToday",
               count(u.id) FILTER (WHERE u.created_at >= b.d6)::int AS "reg7",
               count(u.id) FILTER (WHERE u.created_at >= b.d29)::int AS "reg30",
               count(u.id) FILTER (WHERE u.login_count = 0)::int AS never
        FROM b LEFT JOIN users u ON true
        GROUP BY b.d0, b.d6, b.d29`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        WITH b AS (${bounds})
        SELECT count(l.id)::int AS total,
               count(l.id) FILTER (WHERE l.created_at >= b.d0)::int AS "today",
               count(l.id) FILTER (WHERE l.created_at >= b.d6)::int AS "l7",
               count(l.id) FILTER (WHERE l.created_at >= b.d29)::int AS "l30",
               count(DISTINCT l.user_id) FILTER (WHERE l.created_at >= b.d0)::int AS "activeToday",
               count(DISTINCT l.user_id) FILTER (WHERE l.created_at >= b.d6)::int AS "active7",
               count(DISTINCT l.user_id) FILTER (WHERE l.created_at >= b.d29)::int AS "active30"
        FROM b LEFT JOIN logins l ON true
        GROUP BY b.d0, b.d6, b.d29`,
      this.prisma.user.groupBy({ by: ['source'], _count: { _all: true } }),
      this.prisma.login.groupBy({ by: ['method'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ date: string; registered: number; activeUsers: number; logins: number }[]>`
        WITH days AS (
          SELECT d::date AS day
          FROM generate_series((now() AT TIME ZONE ${tz})::date - ${days - 1}::int, (now() AT TIME ZONE ${tz})::date, interval '1 day') d
        ),
        reg AS (
          SELECT (created_at AT TIME ZONE ${tz})::date AS day, count(*)::int AS n FROM users
          WHERE created_at >= (SELECT min(day) FROM days)::timestamp AT TIME ZONE ${tz} GROUP BY 1
        ),
        log AS (
          SELECT (created_at AT TIME ZONE ${tz})::date AS day, count(*)::int AS n, count(DISTINCT user_id)::int AS u FROM logins
          WHERE created_at >= (SELECT min(day) FROM days)::timestamp AT TIME ZONE ${tz} GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
               coalesce(reg.n, 0) AS registered,
               coalesce(log.u, 0) AS "activeUsers",
               coalesce(log.n, 0) AS logins
        FROM days LEFT JOIN reg USING (day) LEFT JOIN log USING (day)
        ORDER BY days.day`,
    ]);

    const count = <K extends string>(keys: readonly K[], rows: { key: string; n: number }[]) =>
      Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.n ?? 0])) as Record<K, number>;

    return {
      totalUsers: users.total,
      customers: users.total - users.admins,
      admins: users.admins,
      bySource: count(SOURCES, bySource.map((r) => ({ key: r.source, n: r._count._all }))),
      registered: { today: users.regToday, last7Days: users.reg7, last30Days: users.reg30 },
      activeUsers: { today: logins.activeToday, last7Days: logins.active7, last30Days: logins.active30 },
      logins: { today: logins.today, last7Days: logins.l7, last30Days: logins.l30, total: logins.total },
      loginsByMethod: count(LOGIN_METHODS, byMethod.map((r) => ({ key: r.method, n: r._count._all }))),
      neverLoggedIn: users.never,
      timeZone: tz,
      daily,
    };
  }
}
