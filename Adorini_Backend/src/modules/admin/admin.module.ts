import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminCatalogController } from './controllers/admin-catalog.controller';
import { AdminCatalogService } from './services/admin-catalog.service';
import { SearchAnalyticsService } from './services/search-analytics.service';
import { Brand } from '../../database/entities/brand.entity';
import { Category } from '../../database/entities/category.entity';
import { MediaAsset } from '../../database/entities/media-asset.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { SearchQuery } from '../../database/entities/search-query.entity';
import { SizeEnquiry } from '../../database/entities/size-enquiry.entity';
import { User } from '../../database/entities/user.entity';
import { StorageModule } from '../../providers/storage/storage.module';

/**
 * `User` is registered here because `AdminGuard` reads `is_admin` from it on
 * every request rather than trusting a token claim.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductVariant,
      Category,
      Brand,
      SizeEnquiry,
      SearchQuery,
      User,
      MediaAsset,
    ]),
    StorageModule,
  ],
  controllers: [AdminCatalogController],
  providers: [AdminCatalogService, SearchAnalyticsService],
  exports: [AdminCatalogService],
})
export class AdminModule {}
