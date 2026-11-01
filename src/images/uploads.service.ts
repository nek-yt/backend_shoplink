import { Inject, Injectable, Logger } from '@nestjs/common';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config';
import { detectImage, MAX_IMAGE_BYTES, UPLOADS_PATH } from './images';

export type UploadFolder = 'products' | 'avatars';

/** Saves uploaded images in UPLOAD_DIR and deletes them when they are replaced. */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger('Uploads');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Checks the file and saves it under a random name. Returns its public URL. */
  async saveImage(folder: UploadFolder, file: Express.Multer.File | undefined): Promise<string> {
    if (!file) throw new ApiError(400, 'Validation failed', ['image file is required (form field "image")']);
    if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, 'Image is too large (max 5 MB)');
    const ext = detectImage(file.buffer);
    if (!ext) throw new ApiError(400, 'Validation failed', ['image must be a JPEG, PNG, WebP or GIF file']);

    const name = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(this.config.uploadDir, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), file.buffer);
    return `${UPLOADS_PATH}/${folder}/${name}`;
  }

  /** Deletes a file saved by saveImage. URLs of other sites and the defaults are ignored. */
  async remove(url: string | null | undefined): Promise<void> {
    const match = url?.match(/^\/api\/uploads\/(products|avatars)\/([\w-]+\.(?:jpg|png|gif|webp))$/);
    if (!match) return;
    try {
      await fs.unlink(path.join(this.config.uploadDir, match[1], match[2]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn(`Could not delete ${url}: ${String(err)}`);
    }
  }
}
