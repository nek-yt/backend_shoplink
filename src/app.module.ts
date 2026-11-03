import { DynamicModule, Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, type AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { ImagesModule } from './images/images.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { ProductsModule } from './products/products.module';
import { CommentsModule } from './comments/comments.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';

@Global()
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule, ImagesModule, AuthModule, UsersModule, ProductsModule, OrdersModule, WishlistModule, CartModule, ReviewsModule, CommentsModule, ReportsModule, NotificationsModule],
      controllers: [HealthController],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
