import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ReturnsService } from './returns.service';
import { FitTag, OrderStatus, ReturnStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { ReturnRequest } from '../../../database/entities/return-request.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('ReturnsService', () => {
  let service: ReturnsService;
  let returnsFind: jest.Mock;
  let returnsFindOne: jest.Mock;
  let returnsSave: jest.Mock;
  let returnsCreate: jest.Mock;
  let ordersFindOne: jest.Mock;
  let itemsFind: jest.Mock;
  let itemsFindOne: jest.Mock;

  const deliveredOrder = (daysAgo: number): Partial<Order> => ({
    id: 'order-1',
    orderNumber: 'ADR-2026-000001',
    userId: 'user-1',
    status: OrderStatus.DELIVERED,
    deliveredAt: new Date(Date.now() - daysAgo * DAY_MS),
  });

  const orderItem = (overrides: Partial<OrderItem> = {}): Partial<OrderItem> => ({
    id: 'item-1',
    orderId: 'order-1',
    productName: 'Kalankari Kurti',
    sku: 'K-42-INDIGO',
    nominalSize: 42,
    colour: 'Indigo',
    quantity: 2,
    ...overrides,
  });

  beforeEach(async () => {
    returnsFind = jest.fn().mockResolvedValue([]);
    returnsFindOne = jest.fn();
    // Defaults first, then the row's own values — so a `resolvedAt` the service
    // set is preserved rather than clobbered by the stub.
    returnsSave = jest.fn().mockImplementation((r: unknown) =>
      Promise.resolve({
        id: 'return-1',
        createdAt: new Date(),
        resolvedAt: null,
        ...(r as Record<string, unknown>),
      }),
    );
    returnsCreate = jest.fn().mockImplementation((r: unknown) => r);
    ordersFindOne = jest.fn();
    itemsFind = jest.fn().mockResolvedValue([]);
    itemsFindOne = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        {
          provide: getRepositoryToken(ReturnRequest),
          useValue: {
            find: returnsFind,
            findOne: returnsFindOne,
            save: returnsSave,
            create: returnsCreate,
          },
        },
        { provide: getRepositoryToken(Order), useValue: { findOne: ordersFindOne } },
        {
          provide: getRepositoryToken(OrderItem),
          useValue: { find: itemsFind, findOne: itemsFindOne },
        },
      ],
    }).compile();

    service = module.get(ReturnsService);
  });

  describe('the 3-day window', () => {
    it('accepts a request the day after delivery', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(1));
      itemsFindOne.mockResolvedValue(orderItem());

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-1',
          quantity: 1,
          reason: 'CHANGED_MY_MIND',
        }),
      ).resolves.toMatchObject({ status: ReturnStatus.REQUESTED });
    });

    it('refuses once the window has closed', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(4));
      itemsFindOne.mockResolvedValue(orderItem());

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-1',
          quantity: 1,
          reason: 'CHANGED_MY_MIND',
        }),
      ).rejects.toThrow(/within 3 days/i);
    });

    it('measures from delivery, not from placement', async () => {
      // An order placed three weeks ago but delivered yesterday is squarely
      // inside the window. Measuring from placement would quietly punish the
      // buyer for a slow shipment.
      ordersFindOne.mockResolvedValue({
        ...deliveredOrder(1),
        createdAt: new Date(Date.now() - 21 * DAY_MS),
      });
      itemsFindOne.mockResolvedValue(orderItem());

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-1',
          quantity: 1,
          reason: 'DAMAGED_ON_ARRIVAL',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses when there is no delivery date at all', async () => {
      ordersFindOne.mockResolvedValue({ ...deliveredOrder(1), deliveredAt: null });
      itemsFindOne.mockResolvedValue(orderItem());

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-1',
          quantity: 1,
          reason: 'OTHER',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('eligibility', () => {
    it('refuses an order that was never delivered', async () => {
      ordersFindOne.mockResolvedValue({
        ...deliveredOrder(1),
        status: OrderStatus.SHIPPED,
      });

      await expect(service.listEligibleItems('user-1', 'order-1')).rejects.toThrow(
        /Only delivered orders/i,
      );
    });

    it('404s on another buyer’s order', async () => {
      // Scoped by userId in the query, so this is indistinguishable from a
      // non-existent order.
      ordersFindOne.mockResolvedValue(null);

      await expect(service.listEligibleItems('user-1', 'order-9')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('explains why a line is ineligible rather than hiding it', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(1));
      itemsFind.mockResolvedValue([orderItem(), orderItem({ id: 'item-2' })]);
      returnsFind.mockResolvedValue([{ orderItemId: 'item-1' }]);

      const items = await service.listEligibleItems('user-1', 'order-1');

      expect(items[0].isEligible).toBe(false);
      expect(items[0].reasonIneligible).toContain('already been requested');
      expect(items[1]).toMatchObject({ isEligible: true, reasonIneligible: null });
    });

    it('marks everything ineligible once the window closes', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(10));
      itemsFind.mockResolvedValue([orderItem()]);

      const [item] = await service.listEligibleItems('user-1', 'order-1');

      expect(item.isEligible).toBe(false);
      expect(item.reasonIneligible).toMatch(/window has closed/i);
    });
  });

  describe('quantity', () => {
    it('refuses more than was ordered', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(1));
      itemsFindOne.mockResolvedValue(orderItem({ quantity: 2 }));

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-1',
          quantity: 3,
          reason: 'OTHER',
        }),
      ).rejects.toThrow(/You ordered 2/);
    });

    it('rejects an item that belongs to a different order', async () => {
      ordersFindOne.mockResolvedValue(deliveredOrder(1));
      itemsFindOne.mockResolvedValue(null);

      await expect(
        service.requestReturn('user-1', 'order-1', {
          orderItemId: 'item-from-elsewhere',
          quantity: 1,
          reason: 'OTHER',
        }),
      ).rejects.toThrow(/not part of this order/i);
    });
  });

  describe('fit tag', () => {
    it('is carried through so it can correct the size chart', async () => {
      // A return for sizing is the strongest signal a chart is wrong — stronger
      // than a review, because the buyer paid return postage over it.
      ordersFindOne.mockResolvedValue(deliveredOrder(1));
      itemsFindOne.mockResolvedValue(orderItem());

      const result = await service.requestReturn('user-1', 'order-1', {
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'SIZE_TOO_SMALL',
        fitTag: FitTag.RUNS_SMALL,
      });

      expect(result.fitTag).toBe(FitTag.RUNS_SMALL);
    });
  });

  describe('review', () => {
    it('stamps a resolution time when completed', async () => {
      returnsFindOne.mockResolvedValue({
        id: 'return-1',
        orderId: 'order-1',
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'OTHER',
        comment: null,
        fitTag: null,
        status: ReturnStatus.APPROVED,
        adminNote: null,
        resolvedAt: null,
        createdAt: new Date(),
        order: deliveredOrder(1) as Order,
        orderItem: orderItem() as OrderItem,
      });

      const result = await service.review('return-1', ReturnStatus.COMPLETED, 'Received');

      expect(result.status).toBe(ReturnStatus.COMPLETED);
      expect(result.resolvedAt).not.toBeNull();
    });

    it('leaves an approved-but-not-received request unresolved', async () => {
      // Approval is not the end of the story — the goods still have to come back.
      returnsFindOne.mockResolvedValue({
        id: 'return-1',
        orderId: 'order-1',
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'OTHER',
        comment: null,
        fitTag: null,
        status: ReturnStatus.REQUESTED,
        adminNote: null,
        resolvedAt: null,
        createdAt: new Date(),
        order: deliveredOrder(1) as Order,
        orderItem: orderItem() as OrderItem,
      });

      const result = await service.review('return-1', ReturnStatus.APPROVED);

      expect(result.resolvedAt).toBeNull();
    });
  });
});
