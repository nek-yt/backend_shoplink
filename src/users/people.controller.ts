import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../common/api-error';
import { paginate, queryPage, queryString, type Query as QueryParams } from '../common/query';
import { ErrorResponse } from '../common/responses';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { defaultAvatarUrl } from '../images/images';

/** What anyone may see about a person: no email, no phone. */
export class PersonResponse {
  id: number;
  /** @example Aziza Karimova */
  name: string;
  /** @example aziza.style */
  socialUsername: string | null;
  avatarUrl: string;
  /** How many products they sell. */
  productsCount: number;
}

export class PersonPageResponse {
  items: PersonResponse[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

type Row = { id: number; name: string; social_username: string | null; avatar_url: string | null; products_count: number };

@ApiTags('People')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid query' })
@Controller('people')
export class PeopleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Find people',
    description:
      'Public: search by name or @username (never email or phone); admins are left out. Exact @username first, then names starting with the text, then the busiest sellers.',
  })
  @ApiQuery({ name: 'search', required: true, description: 'Name or @username; a leading "@" is ignored' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  async search(@Query() q: QueryParams): Promise<PersonPageResponse> {
    const search = queryString(q, 'search')?.replace(/^@+/, '').trim();
    if (!search) throw new ApiError(400, 'Query parameter search must not be empty');
    if (search.length > 100) throw new ApiError(400, 'Query parameter search must be at most 100 characters');
    const { page, limit } = queryPage(q);

    // Same ICU case folding as the other searches, so Cyrillic names match in any case.
    const term = Prisma.sql`lower(${search}::text COLLATE "und-x-icu")`;
    const name = Prisma.sql`lower(name COLLATE "und-x-icu")`;
    const handle = Prisma.sql`lower(coalesce(social_username, '') COLLATE "und-x-icu")`;
    // Also without spaces, dots, dashes and underscores: "nekp" finds "Nek pro", "aziza style" finds @aziza.style.
    const squash = (s: Prisma.Sql) => Prisma.sql`regexp_replace(${s}, '[[:space:]._-]+', '', 'g')`;
    // The shop's admins are staff, not people to find.
    const where = Prisma.sql`WHERE role <> 'admin' AND (strpos(${name}, ${term}) > 0 OR strpos(${handle}, ${term}) > 0
      OR (${squash(term)} <> '' AND (strpos(${squash(name)}, ${squash(term)}) > 0 OR strpos(${squash(handle)}, ${squash(term)}) > 0)))`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM users ${where}`;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT u.id, u.name, u.social_username, u.avatar_url,
             (SELECT COUNT(*)::int FROM products p WHERE p.seller_id = u.id) AS products_count
      FROM users u ${where}
      ORDER BY (${handle} = ${term}) DESC,
               (strpos(${handle}, ${term}) = 1 OR strpos(${squash(name)}, ${squash(term)}) = 1) DESC,
               products_count DESC,
               u.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      socialUsername: r.social_username,
      avatarUrl: r.avatar_url ?? defaultAvatarUrl(r),
      productsCount: r.products_count,
    }));
    return { items, ...paginate(total, page, limit) };
  }
}
