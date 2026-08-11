import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService, StorageProviderError } from './storage.service';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

describe('StorageService', () => {
  let service: StorageService;
  let mockS3Send: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockS3Send = jest.fn().mockResolvedValue({});

    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockS3Send,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'R2_ACCOUNT_ID':
                  return 'test_account';
                case 'R2_ACCESS_KEY_ID':
                  return 'test_access_key';
                case 'R2_SECRET_ACCESS_KEY':
                  return 'test_secret_key';
                case 'R2_BUCKET_NAME':
                  return 'adorini-media';
                case 'R2_PUBLIC_BASE_URL':
                  return 'https://media.example.com';
                default:
                  return '';
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should send PutObjectCommand and return public URL', async () => {
      const buf = Buffer.from('test');
      const url = await service.uploadFile('images/test.jpg', buf, 'image/jpeg');

      expect(url).toBe('https://media.example.com/images/test.jpg');
      expect(mockS3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('should throw StorageProviderError on S3 send error', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 Connection Failed'));

      await expect(service.uploadFile('key.jpg', Buffer.from(''), 'image/jpeg')).rejects.toThrow(
        StorageProviderError,
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('should call getSignedUrl and return url', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValueOnce('https://presigned.url');

      const url = await service.getPresignedUrl('key.jpg', 600);
      expect(url).toBe('https://presigned.url');
    });
  });

  describe('deleteFile', () => {
    it('should send DeleteObjectCommand', async () => {
      await service.deleteFile('key.jpg');
      expect(mockS3Send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });
});
