import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppValidationPipe } from './common/validation';
import type { AppConfig } from './config';

const DESCRIPTION = `
Backend for **ShopLink**, a small internet shop whose customers come from TikTok, Instagram and Telegram.

**How to try it here:**
1. \`POST /api/auth/login\` with the admin account (\`admin@shoplink.com\` / \`admin12345\` in development),
   or \`POST /api/auth/register\` to create a customer.
2. Copy the \`token\` from the response, click **Authorize** (top right) and paste it.
3. Anyone logged in can sell products and see their sales. Admins can change any product and manage all orders.
4. Pictures: upload with \`PUT /api/products/{id}/image\` and \`PUT /api/auth/me/avatar\`. Without one you get a default picture.

Every error comes back as \`{ "message": "...", "errors": ["..."] }\` (\`errors\` only when there are details).
`;

function parseCorsOrigin(value: string): string | string[] {
  if (value === '*') return '*';
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Builds the configured Nest app (not listening yet). Used by main.ts and the tests. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.env === 'test' ? false : ['error', 'warn'],
  });

  app.set('trust proxy', config.trustProxy);
  // Swagger UI needs inline styles and scripts that helmet's default CSP blocks, so /docs is left out.
  // Images are loaded by the shop from another origin, so they may be embedded cross-origin.
  const security = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith('/docs') ? next() : security(req, res, next)));
  app.enableCors({ origin: parseCorsOrigin(config.corsOrigin) });
  app.useBodyParser('json', { limit: '100kb' });
  // Uploaded pictures are served from the database by UploadsController (GET /api/uploads/{folder}/{name}).

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('ShopLink API').setVersion('2.0.0').setDescription(DESCRIPTION).addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'ShopLink API',
    swaggerOptions: { persistAuthorization: true },
  });
  app.getHttpAdapter().getInstance().get('/', (req: Request, res: Response) => res.redirect('/docs'));

  return app;
}
