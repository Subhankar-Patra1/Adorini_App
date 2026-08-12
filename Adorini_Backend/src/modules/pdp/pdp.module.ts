import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PdpController } from './controllers/pdp.controller';
import { PdpService } from './services/pdp.service';
import { SizeChartService } from './services/size-chart.service';
import { MediaAsset } from '../../database/entities/media-asset.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { Review } from '../../database/entities/review.entity';
import { SizeEnquiry } from '../../database/entities/size-enquiry.entity';
import { StorageModule } from '../../providers/storage/storage.module';

@Module({
  imports: [
    // OrderItem is queried through the transaction EntityManager in
    // PdpService, not injected as a Repository, so it needs no entry here —
    // TypeORM's EntityManager reaches any entity registered on the DataSource.
    TypeOrmModule.forFeature([Product, ProductVariant, MediaAsset, Review, SizeEnquiry]),
    StorageModule,
  ],
  controllers: [PdpController],
  providers: [PdpService, SizeChartService],
})
export class PdpModule {}
