import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import {
  AdminVideoDto,
  CreateVideoDto,
  ListVideosQueryDto,
  ReplaceVideoTagsDto,
  UpdateVideoDto,
  VideoFeedResponseDto,
} from '../dto/videos.dto';
import { VideosService } from '../services/videos.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set(['video/mp4']);
const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface UploadedVideoFiles {
  video?: Express.Multer.File[];
  thumbnail?: Express.Multer.File[];
}

@Public()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  @ApiOperation({ summary: 'Reels-style discovery feed, newest first' })
  @ApiResponse({ status: 200, type: VideoFeedResponseDto })
  listFeed(@Query() query: ListVideosQueryDto): Promise<VideoFeedResponseDto> {
    return this.videos.listFeed(query);
  }
}

/**
 * Video upload and "shop this look" tag curation. Mirrors the admin-catalog
 * controller's guard/interceptor pair: `AdminGuard` re-checks `is_admin` per
 * request rather than trusting a token claim, and every response opts out of
 * edge caching since these carry unpublished drafts (an inactive video is not
 * meant for anyone Cloudflare might have cached it for).
 */
@ApiTags('videos')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@UseInterceptors(NoStoreInterceptor)
@Controller('admin/videos')
export class AdminVideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  @ApiOperation({ summary: 'All videos, including inactive ones' })
  @ApiResponse({ status: 200, type: [AdminVideoDto] })
  listAdmin(): Promise<AdminVideoDto[]> {
    return this.videos.listAdmin();
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_VIDEO_BYTES },
        fileFilter: (_req, file, callback) => {
          const allowed = file.fieldname === 'video' ? VIDEO_MIME_TYPES : THUMBNAIL_MIME_TYPES;
          if (!allowed.has(file.mimetype)) {
            callback(new UnsupportedMediaTypeException(`Unsupported type: ${file.mimetype}`), false);
            return;
          }
          callback(null, true);
        },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a video, optionally with a thumbnail and initial product tags' })
  @ApiResponse({ status: 201, type: AdminVideoDto })
  create(
    @Body() dto: CreateVideoDto,
    @UploadedFiles() files: UploadedVideoFiles,
  ): Promise<AdminVideoDto> {
    const video = files.video?.[0];
    if (!video) {
      throw new BadRequestException('No video file uploaded');
    }

    return this.videos.create(dto, video, files.thumbnail?.[0]);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a video’s caption or feed visibility' })
  @ApiResponse({ status: 200, type: AdminVideoDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<AdminVideoDto> {
    return this.videos.update(id, dto);
  }

  @Post(':id/tags')
  @ApiOperation({ summary: 'Replace the full set of "shop this look" product tags on a video' })
  @ApiResponse({ status: 200, type: AdminVideoDto })
  replaceTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceVideoTagsDto,
  ): Promise<AdminVideoDto> {
    return this.videos.replaceTags(id, dto);
  }
}
