import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CatalogController } from './controllers/catalog.controller';
import { CatalogService } from './services/catalog.service';
import { Brand } from '../../database/entities/brand.entity';
import { Category } from '../../database/entities/category.entity';
import { Product } from '../../database/entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Category, Brand])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
