import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiPayloadTooLargeResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../common/responses';
import { MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES } from './images';

/** multipart/form-data with one file in the field "image". Use with @UploadedFile(). */
export const ImageUpload = () =>
  applyDecorators(
    UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } })),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['image'],
        properties: { image: { type: 'string', format: 'binary', description: 'JPEG, PNG, WebP or GIF, up to 5 MB' } },
      },
    }),
    ApiPayloadTooLargeResponse({ type: ErrorResponse, description: 'Image is larger than 5 MB' }),
  );

/** multipart/form-data with 1 to 10 files in the field "images". Use with @UploadedFiles(). */
export const ImagesUpload = () =>
  applyDecorators(
    UseInterceptors(FilesInterceptor('images', MAX_PRODUCT_IMAGES, { limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_PRODUCT_IMAGES } })),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['images'],
        properties: {
          images: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description: `1 to ${MAX_PRODUCT_IMAGES} files. JPEG, PNG, WebP or GIF, up to 5 MB each`,
          },
        },
      },
    }),
    ApiPayloadTooLargeResponse({ type: ErrorResponse, description: 'An image is larger than 5 MB' }),
  );
