import { Injectable, Logger } from '@nestjs/common';
import { paginate } from '../common/query';
import { PrismaService } from '../database/prisma.service';
import type { Notification, Prisma } from '../generated/prisma/client';

export type NotificationType = 'sale' | 'report';

export class NotificationResponse {
  id: number;
  /** @example sale */
  type: string;
  /** English text, for clients that don't build their own from `data`. @example Aziza bought your product */
  title: string;
  body: string;
  /** Where tapping it should go in the shop. @example /sell/sales/12 */
  link: string | null;
  imageUrl: string | null;
  /** The details (names, counts, order number) for writing the text in the reader's language. */
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export class NotificationPageResponse {
  items: NotificationResponse[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** Unread notifications in total, whatever the page. */
  unread: number;
}

export interface NewNotification {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  imageUrl?: string | null;
  data?: Prisma.InputJsonObject;
}

type Listener = (n: NotificationResponse) => void;

export function toNotification(n: Notification): NotificationResponse {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    imageUrl: n.imageUrl,
    data: (n.data ?? {}) as Record<string, unknown>,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  // Open live streams per user (one per browser tab). In memory: this API runs as a single process.
  private readonly listeners = new Map<number, Set<Listener>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Starts sending this user's new notifications to `listener`. Returns the function that stops it. */
  subscribe(userId: number, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  /**
   * Saves a notification for each user and pushes it to their open tabs. Never throws: a notification that
   * can't be saved must not undo the order or report that caused it.
   */
  async send(userIds: number[], n: NewNotification): Promise<void> {
    for (const userId of new Set(userIds)) {
      try {
        const row = await this.prisma.notification.create({
          data: { userId, type: n.type, title: n.title, body: n.body ?? '', link: n.link ?? null, imageUrl: n.imageUrl ?? null, data: n.data ?? {} },
        });
        const out = toNotification(row);
        for (const listener of this.listeners.get(userId) ?? []) listener(out);
      } catch (err) {
        this.logger.warn(`Couldn't notify user ${userId}: ${(err as Error).message}`);
      }
    }
  }

  async list(userId: number, page: number, limit: number): Promise<NotificationPageResponse> {
    const where = { userId };
    const [total, unread, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    ]);
    return { items: rows.map(toNotification), ...paginate(total, page, limit), unread };
  }

  unreadCount(userId: number): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks the given notifications (or all of them) as read. */
  async markRead(userId: number, ids?: number[]): Promise<{ unread: number }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids && { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
    return { unread: await this.unreadCount(userId) };
  }
}
