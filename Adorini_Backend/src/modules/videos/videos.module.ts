import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminVideosController, VideosController } from './controllers/videos.controller';
import { VideosService } from './services/videos.service';
import { User } from '../../database/entities/user.entity';
import { Video } from '../../database/entities/video.entity';
import { VideoProductTag } from '../../database/entities/video-product-tag.entity';
import { StorageModule } from '../../providers/storage/storage.module';

/** `User` is registered for `AdminGuard`, which reads `is_admin` per request. */
@Module({
  imports: [TypeOrmModule.forFeature([Video, VideoProductTag, User]), StorageModule],
  controllers: [VideosController, AdminVideosController],
  providers: [VideosService],
})
export class VideosModule {}
