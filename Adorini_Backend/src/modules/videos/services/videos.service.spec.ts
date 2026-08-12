import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { VideosService } from './videos.service';
import { encodeCursor } from '../../../common/pagination/cursor.util';
import { Video } from '../../../database/entities/video.entity';
import { VideoProductTag } from '../../../database/entities/video-product-tag.entity';
import { StorageService } from '../../../providers/storage/storage.service';
import type { CreateVideoDto, ReplaceVideoTagsDto, UpdateVideoDto } from '../dto/videos.dto';

function buildQb(overrides: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'select',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'take',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn();
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  Object.assign(qb, overrides);
  return qb;
}

const file = (mimetype: string, buffer = Buffer.from('data')) =>
  ({ mimetype, buffer }) as Express.Multer.File;

const video = (overrides: Partial<Video> = {}): Video =>
  ({
    id: 'video-1',
    objectKey: 'videos/a.mp4',
    thumbnailKey: null,
    caption: null,
    isActive: true,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  }) as Video;

describe('VideosService', () => {
  let service: VideosService;
  let videoQb: ReturnType<typeof buildQb>;
  let tagQb: ReturnType<typeof buildQb>;
  let videosRepo: { createQueryBuilder: jest.Mock; find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
  let tagsRepo: { createQueryBuilder: jest.Mock; find: jest.Mock; delete: jest.Mock };
  let storage: { uploadFile: jest.Mock };
  let manager: { save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    videoQb = buildQb();
    tagQb = buildQb();

    videosRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(videoQb),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    };
    tagsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(tagQb),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    storage = { uploadFile: jest.fn().mockResolvedValue('https://cdn.example.com/uploaded') };
    manager = {
      save: jest.fn((_entity: unknown, v: unknown) =>
        Promise.resolve(
          Array.isArray(v)
            ? v
            : { ...(v as object), id: 'video-1', createdAt: new Date('2026-08-12T00:00:00.000Z') },
        ),
      ),
      create: jest.fn((_entity: unknown, v: unknown) => v),
      delete: jest.fn(),
    };
    dataSource = { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videosRepo },
        { provide: getRepositoryToken(VideoProductTag), useValue: tagsRepo },
        { provide: StorageService, useValue: storage },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://cdn.example.com') },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('listFeed', () => {
    it('only shows active videos', async () => {
      videoQb.getMany.mockResolvedValue([]);

      await service.listFeed({ limit: 10 } as never);

      expect(videoQb.where).toHaveBeenCalledWith('video.isActive = true');
    });

    it('maps a video and resolves its media URLs', async () => {
      videoQb.getMany.mockResolvedValue([video({ thumbnailKey: 'videos/thumbnails/a.jpg' })]);

      const result = await service.listFeed({ limit: 10 } as never);

      expect(result.items[0]).toMatchObject({
        id: 'video-1',
        url: 'https://cdn.example.com/videos/a.mp4',
        thumbnailUrl: 'https://cdn.example.com/videos/thumbnails/a.jpg',
      });
    });

    it('paginates with a seek cursor over (created_at, id)', async () => {
      videoQb.getMany.mockResolvedValue([
        video({ id: 'v1', createdAt: new Date('2026-08-03T00:00:00.000Z') }),
        video({ id: 'v2', createdAt: new Date('2026-08-02T00:00:00.000Z') }),
        video({ id: 'v3', createdAt: new Date('2026-08-01T00:00:00.000Z') }),
      ]);

      const result = await service.listFeed({ limit: 2 } as never);

      expect(result.items.map((i) => i.id)).toEqual(['v1', 'v2']);
      expect(result.nextCursor).toBe(
        encodeCursor({ sortValue: '2026-08-02T00:00:00.000Z', id: 'v2' }),
      );
    });

    it('attaches tagged products in tag display order', async () => {
      videoQb.getMany.mockResolvedValue([video()]);
      tagQb.getRawMany.mockResolvedValue([
        {
          videoId: 'video-1',
          productId: 'prod-1',
          slug: 'kurti',
          name: 'Kurti',
          pricePaise: 74900,
          thumbnailKey: 'products/kurti.jpg',
        },
      ]);

      const result = await service.listFeed({ limit: 10 } as never);

      expect(result.items[0].taggedProducts).toEqual([
        {
          id: 'prod-1',
          slug: 'kurti',
          name: 'Kurti',
          pricePaise: 74900,
          thumbnailUrl: 'https://cdn.example.com/products/kurti.jpg',
        },
      ]);
    });

    it('skips the tag query entirely for an empty page', async () => {
      videoQb.getMany.mockResolvedValue([]);

      await service.listFeed({ limit: 10 } as never);

      expect(tagsRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto: CreateVideoDto = { caption: 'New drop', productIds: ['prod-1', 'prod-2'] };

    it('uploads the video before opening the transaction', async () => {
      await service.create(dto, file('video/mp4'));

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/.+\.mp4$/),
        expect.any(Buffer),
        'video/mp4',
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('uploads a thumbnail when one is supplied', async () => {
      await service.create(dto, file('video/mp4'), file('image/jpeg'));

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/thumbnails\/.+\.jpg$/),
        expect.any(Buffer),
        'image/jpeg',
      );
    });

    it('creates a tag row per product id, in order', async () => {
      await service.create(dto, file('video/mp4'));

      expect(manager.save).toHaveBeenCalledWith(VideoProductTag, [
        expect.objectContaining({ videoId: 'video-1', productId: 'prod-1', displayOrder: 0 }),
        expect.objectContaining({ videoId: 'video-1', productId: 'prod-2', displayOrder: 1 }),
      ]);
    });

    it('creates no tags when none are supplied', async () => {
      await service.create({ caption: undefined, productIds: [] }, file('video/mp4'));

      expect(manager.save).toHaveBeenCalledTimes(1); // the Video save only
    });

    it('does not persist a video row when the upload itself fails', async () => {
      storage.uploadFile.mockRejectedValue(new Error('R2 unavailable'));

      await expect(service.create(dto, file('video/mp4'))).rejects.toThrow('R2 unavailable');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s for an unknown video', async () => {
      videosRepo.findOne.mockResolvedValue(null);

      await expect(service.update('nope', {} as UpdateVideoDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates only the fields provided', async () => {
      const existing = video({ caption: 'Old', isActive: true });
      videosRepo.findOne.mockResolvedValue(existing);

      await service.update('video-1', { isActive: false } as UpdateVideoDto);

      expect(existing.caption).toBe('Old');
      expect(existing.isActive).toBe(false);
    });
  });

  describe('replaceTags', () => {
    it('404s for an unknown video', async () => {
      videosRepo.findOne.mockResolvedValue(null);

      await expect(
        service.replaceTags('nope', { productIds: [] } as ReplaceVideoTagsDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the existing tag set before inserting the new one', async () => {
      videosRepo.findOne.mockResolvedValue(video());

      await service.replaceTags('video-1', { productIds: ['prod-9'] });

      expect(manager.delete).toHaveBeenCalledWith(VideoProductTag, { videoId: 'video-1' });
      expect(manager.save).toHaveBeenCalledWith(VideoProductTag, [
        expect.objectContaining({ videoId: 'video-1', productId: 'prod-9', displayOrder: 0 }),
      ]);
    });

    it('leaves a video with no tags when given an empty list', async () => {
      videosRepo.findOne.mockResolvedValue(video());

      await service.replaceTags('video-1', { productIds: [] });

      expect(manager.delete).toHaveBeenCalledWith(VideoProductTag, { videoId: 'video-1' });
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('listAdmin', () => {
    it('groups tag rows by video and includes inactive videos', async () => {
      videosRepo.find.mockResolvedValue([video({ id: 'v1' }), video({ id: 'v2', isActive: false })]);
      tagsRepo.find.mockResolvedValue([
        { videoId: 'v1', productId: 'p1', displayOrder: 0 },
        { videoId: 'v1', productId: 'p2', displayOrder: 1 },
      ]);

      const result = await service.listAdmin();

      expect(result.find((v) => v.id === 'v1')?.taggedProductIds).toEqual(['p1', 'p2']);
      expect(result.find((v) => v.id === 'v2')?.taggedProductIds).toEqual([]);
      expect(result.find((v) => v.id === 'v2')?.isActive).toBe(false);
    });
  });
});
