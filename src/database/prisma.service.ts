import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const schema = config.databaseSchema;
    if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
    // search_path makes raw SQL use the same schema as the generated queries.
    const adapter = new PrismaPg(
      { connectionString: config.databaseUrl, ...(schema && { options: `-c search_path=${schema}` }) },
      schema ? { schema } : undefined,
    );
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
