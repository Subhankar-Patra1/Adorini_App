import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { CatalogController } from './catalog.controller';
import { CatalogService } from '../services/catalog.service';
import type { ListProductsQueryDto } from '../dto/list-products-query.dto';

describe('CatalogController', () => {
  let controller: CatalogController;
  let service: { listCategories: jest.Mock; listBrands: jest.Mock; listProducts: jest.Mock };

  beforeEach(async () => {
    service = {
      listCategories: jest.fn(),
      listBrands: jest.fn(),
      listProducts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: service }],
    }).compile();

    controller = module.get(CatalogController);
  });

  it('delegates listCategories to the service', async () => {
    service.listCategories.mockResolvedValue([]);
    await controller.listCategories();
    expect(service.listCategories).toHaveBeenCalled();
  });

  it('delegates listBrands to the service', async () => {
    service.listBrands.mockResolvedValue([]);
    await controller.listBrands();
    expect(service.listBrands).toHaveBeenCalled();
  });

  it('delegates listProducts to the service with the query DTO', async () => {
    const query = { sort: 'newest', limit: 20 } as ListProductsQueryDto;
    service.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listProducts(query);

    expect(service.listProducts).toHaveBeenCalledWith(query);
  });
});
