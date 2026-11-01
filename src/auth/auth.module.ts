import { Inject, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config';
import { AuthController } from './auth.controller';
import { AdminGuard, AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ImagesModule } from '../images/images.module';

@Module({
  imports: [
    ImagesModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: config.jwtExpiresIn as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminGuard],
  exports: [AuthService, AuthGuard, AdminGuard, JwtModule],
})
export class AuthModule implements NestModule {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  configure(consumer: MiddlewareConsumer) {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: this.config.authRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => this.config.authRateLimit === 0,
      // Only failed attempts count, so someone logging in correctly is never locked out.
      skipSuccessfulRequests: true,
      handler: (req, res) => {
        res.status(429).json(new ApiError(429, 'Too many attempts, please try again later').getResponse());
      },
    });
    const routes = ['register', 'login', 'telegram', 'telegram-webapp', 'tiktok', 'instagram'];
    consumer.apply(limiter).forRoutes(...routes.map((r) => ({ path: `auth/${r}`, method: RequestMethod.POST })));
  }
}
