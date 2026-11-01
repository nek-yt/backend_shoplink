import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';

const UNIQUE_VIOLATION = { prisma: 'P2002', postgres: '23505' };

/** Every error leaves the API as `{ message, errors? }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ShopLink');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(err);
    res.status(status).json(body);
  }

  private toResponse(err: unknown): [number, { message: string; errors?: string[] }] {
    // Body parser errors (bad JSON, too large) arrive as plain errors with a `type`.
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') return [400, { message: 'Invalid JSON body' }];
    if (type === 'entity.too.large') return [413, { message: 'Request body is too large' }];

    if (err instanceof HttpException) {
      const status = err.getStatus();
      const response = err.getResponse();
      // Nest's own "Cannot GET /x" when no route matches.
      if (err instanceof NotFoundException && typeof response === 'object' && String((response as any).message).startsWith('Cannot ')) {
        return [404, { message: 'Route not found' }];
      }
      if (typeof response === 'string') return [status, { message: response }];
      const { message, errors } = response as { message?: unknown; errors?: string[] };
      return [status, { message: Array.isArray(message) ? message.join(', ') : String(message ?? err.message), ...(errors && { errors }) }];
    }

    // Two people registering the same email at the same moment, for example.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const pgCode = (err.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined)?.driverAdapterError?.cause?.originalCode;
      if (err.code === UNIQUE_VIOLATION.prisma || pgCode === UNIQUE_VIOLATION.postgres) return [409, { message: 'Already exists' }];
    }

    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return [500, { message: 'Internal server error' }];
  }
}
