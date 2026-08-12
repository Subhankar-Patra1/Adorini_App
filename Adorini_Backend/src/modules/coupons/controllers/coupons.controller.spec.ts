import { Test, type TestingModule } from '@nestjs/testing';

import { AdminCouponsController } from './coupons.controller';
import { CouponsService } from '../services/coupons.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import type { CreateCouponDto, UpdateCouponDto } from '../dto/coupons.dto';

describe('AdminCouponsController', () => {
  let controller: AdminCouponsController;
  let coupons: { listCoupons: jest.Mock; createCoupon: jest.Mock; updateCoupon: jest.Mock };

  beforeEach(async () => {
    coupons = {
      listCoupons: jest.fn(),
      createCoupon: jest.fn(),
      updateCoupon: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCouponsController],
      providers: [{ provide: CouponsService, useValue: coupons }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminCouponsController);
  });

  it('lists coupons via the service', async () => {
    coupons.listCoupons.mockResolvedValue([]);

    await controller.list();

    expect(coupons.listCoupons).toHaveBeenCalled();
  });

  it('delegates creation to the service', async () => {
    const dto = { code: 'WELCOME10' } as CreateCouponDto;
    coupons.createCoupon.mockResolvedValue({});

    await controller.create(dto);

    expect(coupons.createCoupon).toHaveBeenCalledWith(dto);
  });

  it('delegates updates to the service', async () => {
    const dto = { isActive: false } as UpdateCouponDto;
    coupons.updateCoupon.mockResolvedValue({});

    await controller.update('coupon-1', dto);

    expect(coupons.updateCoupon).toHaveBeenCalledWith('coupon-1', dto);
  });
});
