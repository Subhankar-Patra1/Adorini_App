import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { PdpController } from './pdp.controller';
import { PdpService } from '../services/pdp.service';
import type { CreateSizeEnquiryDto } from '../dto/create-size-enquiry.dto';
import type { ListReviewsQueryDto } from '../dto/review.dto';

describe('PdpController', () => {
  let controller: PdpController;
  let service: {
    getProductDetail: jest.Mock;
    listReviews: jest.Mock;
    createSizeEnquiry: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getProductDetail: jest.fn(),
      listReviews: jest.fn(),
      createSizeEnquiry: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PdpController],
      providers: [{ provide: PdpService, useValue: service }],
    }).compile();

    controller = module.get(PdpController);
  });

  it('passes the slug through to getProductDetail', async () => {
    service.getProductDetail.mockResolvedValue({});
    await controller.getProductDetail('some-kurti');
    expect(service.getProductDetail).toHaveBeenCalledWith('some-kurti');
  });

  it('passes the slug and query through to listReviews', async () => {
    const query = { limit: 10 } as ListReviewsQueryDto;
    service.listReviews.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listReviews('some-kurti', query);

    expect(service.listReviews).toHaveBeenCalledWith('some-kurti', query);
  });

  it('passes the slug and body through to createSizeEnquiry', async () => {
    const dto = { requestedSize: '50', contactPhone: '919876543210' } as CreateSizeEnquiryDto;
    service.createSizeEnquiry.mockResolvedValue({});

    await controller.createSizeEnquiry('some-kurti', dto, undefined);

    expect(service.createSizeEnquiry).toHaveBeenCalledWith('some-kurti', dto, null);
  });

  it('attributes the enquiry when a signed-in buyer submits it', async () => {
    // The route is public so a first-time visitor can still enquire, but an
    // enquiry from a known customer should reach the admin inbox attached to
    // their account rather than as an anonymous phone number.
    const dto = { requestedSize: '50', contactPhone: '919876543210' } as CreateSizeEnquiryDto;
    service.createSizeEnquiry.mockResolvedValue({});

    await controller.createSizeEnquiry('some-kurti', dto, { id: 'user-1' });

    expect(service.createSizeEnquiry).toHaveBeenCalledWith('some-kurti', dto, 'user-1');
  });
});
