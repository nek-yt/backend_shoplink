import { applyDecorators, CanActivate, createParamDecorator, ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';
import { MAX_ID } from '../common/constants';
import { ErrorResponse } from '../common/responses';
import { PrismaService } from '../database/prisma.service';
import type { User } from '../generated/prisma/client';

export interface AuthedRequest extends Request {
  user: User;
}

/** Requires `Authorization: Bearer <token>` and puts the logged-in user on the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Missing Bearer token');
    let payload: { uid?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'Invalid or expired token');
    }
    // Load the user on every request so deleted users and role changes take effect immediately.
    const uid = payload.uid;
    const valid = typeof uid === 'number' && Number.isInteger(uid) && uid >= 1 && uid <= MAX_ID;
    const user = valid ? await this.prisma.user.findUnique({ where: { id: uid } }) : null;
    if (!user) throw new ApiError(401, 'User no longer exists');
    req.user = user;
    return true;
  }
}

/** Runs after AuthGuard: only admins get through. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user.role !== 'admin') throw new ApiError(403, 'Admin access required');
    return true;
  }
}

/** Logged-in users only. */
export const Auth = () =>
  applyDecorators(UseGuards(AuthGuard), ApiBearerAuth(), ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Not logged in' }));

/** Admins only. */
export const Admin = () =>
  applyDecorators(
    UseGuards(AuthGuard, AdminGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ type: ErrorResponse, description: 'Not logged in' }),
    ApiForbiddenResponse({ type: ErrorResponse, description: 'Not an admin' }),
  );

/** The logged-in user (use together with @Auth() or @Admin()). */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<AuthedRequest>().user;
});
