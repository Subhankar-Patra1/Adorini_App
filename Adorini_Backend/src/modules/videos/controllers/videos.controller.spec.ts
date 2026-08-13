import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AdminVideosController, VideosController } from './videos.controller';
import { VideosService } from '../services/videos.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import type { CreateVideoDto, UpdateVideoDto } from '../dto/videos.dto';

describe('VideosController', () => {
  let controller: VideosController;
  let videos: { listFeed: jest.Mock };

  beforeEach(async () => {
    videos = { listFeed: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [{ provide: VideosService, useValue: videos }],
    }).compile();

    controller = module.get(VideosController);
  });

  it('delegates the feed query to the service', async () => {
    const query = { limit: 5 } as never;
    videos.listFeed.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listFeed(query);

    expect(videos.listFeed).toHaveBeenCalledWith(query);
  });
});

describe('AdminVideosController', () => {
  let controller: AdminVideosController;
  let videos: {
    listAdmin: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    replaceTags: jest.Mock;
  };

  beforeEach(async () => {
    videos = {
      listAdmin: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      replaceTags: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminVideosController],
      providers: [{ provide: VideosService, useValue: videos }],
    })
      // AdminGuard re-reads `is_admin` from the User repository per request —
      // irrelevant to what this suite is testing (that the controller
      // delegates correctly), so it is stubbed rather than wired for real.
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminVideosController);
  });

  it('lists all videos via the service', async () => {
    videos.listAdmin.mockResolvedValue([]);

    await controller.listAdmin();

    expect(videos.listAdmin).toHaveBeenCalled();
  });

  it('rejects a create request with no video file', () => {
    const dto = { productIds: [] } as CreateVideoDto;

    expect(() => controller.create(dto, {})).toThrow(BadRequestException);
    expect(videos.create).not.toHaveBeenCalled();
  });

  it('passes the video, and thumbnail when present, through to the service', async () => {
    const dto = { productIds: [] } as CreateVideoDto;
    const videoFile = { mimetype: 'video/mp4' } as Express.Multer.File;
    const thumbFile = { mimetype: 'image/jpeg' } as Express.Multer.File;
    videos.create.mockResolvedValue({});

    await controller.create(dto, { video: [videoFile], thumbnail: [thumbFile] });

    expect(videos.create).toHaveBeenCalledWith(dto, videoFile, thumbFile);
  });

  it('passes an undefined thumbnail through when none was uploaded', async () => {
    const dto = { productIds: [] } as CreateVideoDto;
    const videoFile = { mimetype: 'video/mp4' } as Express.Multer.File;
    videos.create.mockResolvedValue({});

    await controller.create(dto, { video: [videoFile] });

    expect(videos.create).toHaveBeenCalledWith(dto, videoFile, undefined);
  });

  it('delegates update to the service', async () => {
    const dto = { isActive: false } as UpdateVideoDto;
    videos.update.mockResolvedValue({});

    await controller.update('video-1', dto);

    expect(videos.update).toHaveBeenCalledWith('video-1', dto);
  });

  it('delegates tag replacement to the service', async () => {
    const dto = { productIds: ['prod-1'] };
    videos.replaceTags.mockResolvedValue({});

    await controller.replaceTags('video-1', dto);

    expect(videos.replaceTags).toHaveBeenCalledWith('video-1', dto);
  });
});
