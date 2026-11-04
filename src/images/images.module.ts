import { Module } from '@nestjs/common';
import { ImagesController } from './images.controller';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [ImagesController, UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class ImagesModule {}
