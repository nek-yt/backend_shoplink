import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Auth, CurrentUser } from '../auth/auth.guard';
import { ApiError } from '../common/api-error';
import { MAX_ID } from '../common/constants';
import { type Query as QueryParams, queryPage } from '../common/query';
import { Check, Optional, rules } from '../common/validation';
import { PrismaService } from '../database/prisma.service';
import type { User } from '../generated/prisma/client';
import { NotificationPageResponse, NotificationsService } from './notifications.service';

export class MarkReadDto {
  /** Leave out to mark all of them read. @example [3, 4] */
  @Optional()
  @Check(rules.nonEmptyArray({ max: 100 }))
  ids?: number[];
}

// Proxies (Render's included) close quiet connections, so the stream says something every 25 seconds.
const HEARTBEAT_MS = 25_000;

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'My notifications', description: 'Newest first, with how many are unread.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@CurrentUser() user: User, @Query() q: QueryParams): Promise<NotificationPageResponse> {
    const { page, limit } = queryPage(q);
    return this.notifications.list(user.id, page, limit);
  }

  @Post('read')
  @Auth()
  @ApiOperation({ summary: 'Mark notifications read', description: 'The given ids, or all of them when `ids` is left out.' })
  markRead(@CurrentUser() user: User, @Body() body: MarkReadDto): Promise<{ unread: number }> {
    const ids = body.ids?.filter((id) => Number.isInteger(id) && id >= 1 && id <= MAX_ID);
    return this.notifications.markRead(user.id, ids);
  }

  /**
   * A live stream (Server-Sent Events): `event: notification` for each new one, `event: unread` with the count.
   * Browsers' EventSource can't send headers, so the login token comes in the query string.
   */
  @Get('stream')
  @ApiOperation({ summary: 'Live notifications (Server-Sent Events)', description: 'Pass the login token as ?token=. Keeps the connection open.' })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiProduces('text/event-stream')
  async stream(@Query('token') token: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = await this.userFromToken(token);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx-style proxies not to hold the events back.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write('retry: 5000\n\n'); // how long the browser waits before reconnecting
    write('unread', { unread: await this.notifications.unreadCount(user.id) });

    const stop = this.notifications.subscribe(user.id, (n) => {
      write('notification', n);
      this.notifications.unreadCount(user.id).then((unread) => write('unread', { unread }), () => {});
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      stop();
    });
  }

  private async userFromToken(token: string | undefined): Promise<User> {
    if (!token) throw new ApiError(401, 'Missing token');
    let payload: { uid?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'Invalid or expired token');
    }
    const uid = payload.uid;
    const valid = typeof uid === 'number' && Number.isInteger(uid) && uid >= 1 && uid <= MAX_ID;
    const user = valid ? await this.prisma.user.findUnique({ where: { id: uid } }) : null;
    if (!user) throw new ApiError(401, 'User no longer exists');
    return user;
  }
}
