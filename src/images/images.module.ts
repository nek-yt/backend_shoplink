import { Module } from '@nestjs/common';
import { ImagesController } from './images.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [ImagesController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class ImagesModule {}
