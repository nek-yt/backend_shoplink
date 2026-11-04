import { Inject, Injectable, Logger } from '@nestjs/common';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../database/prisma.service';
import { detectImage, MAX_IMAGE_BYTES, UPLOADS_PATH } from './images';

export type UploadFolder = 'products' | 'avatars';

const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
/** A file name saveImage makes: a random id and the picture's extension. */
export const UPLOAD_NAME = /^[\w-]+\.(jpg|png|gif|webp)$/;

/**
 * Saves uploaded images in the database (table `uploads`) and deletes them when they are replaced.
 * Not on disk: hosts like Render's free plan wipe the disk on every deploy and restart.
 * Pictures saved on disk by older versions (UPLOAD_DIR) are still served, and copied into the database the first time.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger('Uploads');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Checks the file and saves it under a random name. Returns its public URL. */
  async saveImage(folder: UploadFolder, file: Express.Multer.File | undefined): Promise<string> {
    if (!file) throw new ApiError(400, 'Validation failed', ['image file is required (form field "image")']);
    if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, 'Image is too large (max 5 MB)');
    const ext = detectImage(file.buffer);
    if (!ext) throw new ApiError(400, 'Validation failed', ['image must be a JPEG, PNG, WebP or GIF file']);

    const name = `${crypto.randomUUID()}.${ext}`;
    await this.prisma.upload.create({ data: { name, folder, contentType: CONTENT_TYPES[ext], data: new Uint8Array(file.buffer) } });
    return `${UPLOADS_PATH}/${folder}/${name}`;
  }

  /** The picture behind /api/uploads/{folder}/{name}, or null. */
  async read(folder: string, name: string): Promise<{ contentType: string; data: Buffer } | null> {
    if ((folder !== 'products' && folder !== 'avatars') || !UPLOAD_NAME.test(name)) return null;
    const row = await this.prisma.upload.findUnique({ where: { name } });
    if (row && row.folder === folder) return { contentType: row.contentType, data: Buffer.from(row.data) };
    return this.readOldFile(folder, name);
  }

  /** A picture an older version saved on disk: served, and copied into the database so it survives the next wipe. */
  private async readOldFile(folder: UploadFolder, name: string) {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(this.config.uploadDir, folder, name));
    } catch {
      return null;
    }
    const contentType = CONTENT_TYPES[name.split('.').pop()!];
    await this.prisma.upload
      .create({ data: { name, folder, contentType, data: new Uint8Array(data) } })
      .catch(() => {}); // already copied by a request at the same moment
    return { contentType, data };
  }

  /** Deletes a picture saved by saveImage. URLs of other sites and the defaults are ignored. */
  async remove(url: string | null | undefined): Promise<void> {
    const match = url?.match(/^\/api\/uploads\/(products|avatars)\/([\w-]+\.(?:jpg|png|gif|webp))$/);
    if (!match) return;
    try {
      await this.prisma.upload.deleteMany({ where: { name: match[2] } });
      await fs.unlink(path.join(this.config.uploadDir, match[1], match[2])).catch(() => {}); // an old copy on disk, if any
    } catch (err) {
      this.logger.warn(`Could not delete ${url}: ${String(err)}`);
    }
  }
}
