import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { PdpController } from './pdp.controller';
import { PdpService } from '../services/pdp.service';
import type { CreateSizeEnquiryDto } from '../dto/create-size-enquiry.dto';
import type { CreateReviewDto } from '../dto/review.dto';
import type { ListReviewsQueryDto } from '../dto/review.dto';

describe('PdpController', () => {
  let controller: PdpController;
  let service: {
    getProductDetail: jest.Mock;
    listReviews: jest.Mock;
    createSizeEnquiry: jest.Mock;
    createReview: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getProductDetail: jest.fn(),
      listReviews: jest.fn(),
      createSizeEnquiry: jest.fn(),
      createReview: jest.fn(),
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

  it('passes the slug, body, caller id, and photos through to createReview', async () => {
    const dto = { rating: 5 } as CreateReviewDto;
    const photos = [{ mimetype: 'image/jpeg', buffer: Buffer.from('x') }] as Express.Multer.File[];
    service.createReview.mockResolvedValue({});

    await controller.createReview('some-kurti', dto, { id: 'user-1' }, photos);

    expect(service.createReview).toHaveBeenCalledWith('some-kurti', dto, 'user-1', photos);
  });

  it('defaults to an empty photo array when none are uploaded', async () => {
    const dto = { rating: 5 } as CreateReviewDto;
    service.createReview.mockResolvedValue({});

    await controller.createReview('some-kurti', dto, { id: 'user-1' }, undefined as never);

    expect(service.createReview).toHaveBeenCalledWith('some-kurti', dto, 'user-1', []);
  });
});
