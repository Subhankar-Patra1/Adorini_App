import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';

import { CodVerificationSweepService } from './cod-verification-sweep.service';
import { OrderStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { OrdersService } from '../../orders/services/orders.service';

describe('CodVerificationSweepService', () => {
  let service: CodVerificationSweepService;
  let orders: { find: jest.Mock };
  let ordersService: { autoCancelUnverifiedCod: jest.Mock };

  beforeEach(async () => {
    orders = { find: jest.fn().mockResolvedValue([]) };
    ordersService = { autoCancelUnverifiedCod: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodVerificationSweepService,
        { provide: getRepositoryToken(Order), useValue: orders },
        { provide: OrdersService, useValue: ordersService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(24) },
        },
      ],
    }).compile();

    service = module.get(CodVerificationSweepService);
  });

  it('queries only PENDING_VERIFICATION orders older than the configured timeout', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00.000Z'));

    await service.sweep();

    expect(orders.find).toHaveBeenCalledWith({
      where: {
        status: OrderStatus.PENDING_VERIFICATION,
        createdAt: LessThan(new Date('2026-08-12T12:00:00.000Z')),
      },
      select: { id: true, orderNumber: true },
    });

    jest.useRealTimers();
  });

  it('does nothing when no orders are overdue', async () => {
    orders.find.mockResolvedValue([]);

    await service.sweep();

    expect(ordersService.autoCancelUnverifiedCod).not.toHaveBeenCalled();
  });

  it('cancels every overdue order individually', async () => {
    orders.find.mockResolvedValue([
      { id: 'order-1', orderNumber: 'ADR-1' },
      { id: 'order-2', orderNumber: 'ADR-2' },
    ]);

    await service.sweep();

    expect(ordersService.autoCancelUnverifiedCod).toHaveBeenCalledWith('order-1');
    expect(ordersService.autoCancelUnverifiedCod).toHaveBeenCalledWith('order-2');
    expect(ordersService.autoCancelUnverifiedCod).toHaveBeenCalledTimes(2);
  });

  it('keeps sweeping the rest when one order fails', async () => {
    orders.find.mockResolvedValue([
      { id: 'order-1', orderNumber: 'ADR-1' },
      { id: 'order-2', orderNumber: 'ADR-2' },
    ]);
    ordersService.autoCancelUnverifiedCod
      .mockRejectedValueOnce(new Error('row lock timeout'))
      .mockResolvedValueOnce(true);

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(ordersService.autoCancelUnverifiedCod).toHaveBeenCalledTimes(2);
  });
});
