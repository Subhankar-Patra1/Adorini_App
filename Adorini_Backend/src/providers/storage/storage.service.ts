import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../../config/env.validation';

export class StorageProviderError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'StorageProviderError';
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const accountId = config.get('R2_ACCOUNT_ID', { infer: true });
    const accessKeyId = config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    this.bucketName = config.get('R2_BUCKET_NAME', { infer: true });
    const rawPublicUrl = config.get('R2_PUBLIC_BASE_URL', { infer: true });
    this.publicBaseUrl = rawPublicUrl.replace(/\/$/, '');

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Uploads a file buffer to Cloudflare R2 and returns its public URL.
   */
  async uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });

      await this.s3Client.send(command);
      return `${this.publicBaseUrl}/${key}`;
    } catch (error) {
      this.logger.error(`Cloudflare R2 uploadFile failed for key ${key}`, error);
      throw new StorageProviderError(
        `Failed to upload file to R2: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Generates a presigned download URL for a file key.
   */
  async getPresignedUrl(key: string, expiresSeconds = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: expiresSeconds });
    } catch (error) {
      this.logger.error(`Cloudflare R2 getPresignedUrl failed for key ${key}`, error);
      throw new StorageProviderError(
        `Failed to generate presigned URL: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Deletes a file from Cloudflare R2.
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Cloudflare R2 deleteFile failed for key ${key}`, error);
      throw new StorageProviderError(
        `Failed to delete file from R2: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}
