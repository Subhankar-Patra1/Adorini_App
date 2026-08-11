import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AddressesService } from './addresses.service';
import { Address } from '../../../database/entities';

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'addr-1',
    userId: 'user-1',
    recipientName: 'Test Buyer',
    recipientPhone: '919876543210',
    line1: '1 Test Road',
    line2: null,
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700001',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Address;
}

const validInput = {
  recipientName: 'Test Buyer',
  recipientPhone: '919876543210',
  line1: '1 Test Road',
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700001',
};

describe('AddressesService', () => {
  let service: AddressesService;
  let repoFind: jest.Mock;
  let repoFindOne: jest.Mock;
  let mCount: jest.Mock;
  let mFindOne: jest.Mock;
  let mUpdate: jest.Mock;
  let mSave: jest.Mock;
  let mDelete: jest.Mock;

  beforeEach(async () => {
    repoFind = jest.fn().mockResolvedValue([]);
    repoFindOne = jest.fn().mockResolvedValue(makeAddress());

    mCount = jest.fn().mockResolvedValue(0);
    mFindOne = jest.fn().mockResolvedValue(makeAddress());
    mUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    mSave = jest.fn().mockImplementation((_e, row: Address) => Promise.resolve(row));
    mDelete = jest.fn().mockResolvedValue({ affected: 1 });

    const manager = {
      count: mCount,
      findOne: mFindOne,
      update: mUpdate,
      save: mSave,
      delete: mDelete,
      create: (_entity: unknown, data: Partial<Address>) => makeAddress(data),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        {
          provide: getRepositoryToken(Address),
          useValue: { find: repoFind, findOne: repoFindOne },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
          },
        },
      ],
    }).compile();

    service = module.get(AddressesService);
  });

  describe('list', () => {
    it('scopes to the user and puts the default first', async () => {
      await service.list('user-1');

      expect(repoFind).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      });
    });
  });

  describe('create', () => {
    it('forces the very first address to be the default', async () => {
      // A buyer with exactly one address and no default would give checkout
      // nothing to preselect.
      mCount.mockResolvedValue(0);

      const created = await service.create('user-1', validInput);

      expect(created.isDefault).toBe(true);
    });

    it('leaves a later address non-default unless asked', async () => {
      mCount.mockResolvedValue(2);

      const created = await service.create('user-1', validInput);

      expect(created.isDefault).toBe(false);
      expect(mUpdate).not.toHaveBeenCalled();
    });

    it('demotes the previous default when a new one is requested', async () => {
      mCount.mockResolvedValue(2);

      await service.create('user-1', { ...validInput, isDefault: true });

      expect(mUpdate).toHaveBeenCalledWith(Address, { userId: 'user-1' }, { isDefault: false });
    });

    it('always attaches the caller as owner', async () => {
      const created = await service.create('user-1', validInput);

      expect(created.userId).toBe('user-1');
    });
  });

  describe('setDefault', () => {
    it('demotes the others and promotes this one', async () => {
      const address = makeAddress();
      mFindOne.mockResolvedValue(address);

      const result = await service.setDefault('user-1', 'addr-1');

      expect(mUpdate).toHaveBeenCalledWith(Address, expect.objectContaining({ userId: 'user-1' }), {
        isDefault: false,
      });
      expect(result.isDefault).toBe(true);
    });

    it('404s for an address belonging to someone else', async () => {
      mFindOne.mockResolvedValue(null);

      await expect(service.setDefault('user-1', 'addr-9')).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup by userId in the query', async () => {
      // Ownership is filtered in the WHERE clause, not checked after loading.
      await service.setDefault('user-1', 'addr-1');

      expect(mFindOne).toHaveBeenCalledWith(Address, {
        where: { id: 'addr-1', userId: 'user-1' },
      });
    });
  });

  describe('remove', () => {
    it('promotes the newest survivor when the default is deleted', async () => {
      // Otherwise the buyer silently ends up with no default at checkout.
      mFindOne
        .mockResolvedValueOnce(makeAddress({ isDefault: true }))
        .mockResolvedValueOnce(makeAddress({ id: 'addr-2' }));

      await service.remove('user-1', 'addr-1');

      expect(mUpdate).toHaveBeenCalledWith(Address, { id: 'addr-2' }, { isDefault: true });
    });

    it('promotes nothing when a non-default is deleted', async () => {
      mFindOne.mockResolvedValue(makeAddress({ isDefault: false }));

      await service.remove('user-1', 'addr-1');

      expect(mUpdate).not.toHaveBeenCalled();
    });

    it('does not fall over when the last address is deleted', async () => {
      mFindOne.mockResolvedValueOnce(makeAddress({ isDefault: true })).mockResolvedValueOnce(null);

      await expect(service.remove('user-1', 'addr-1')).resolves.toBeUndefined();
    });

    it('404s for someone else’s address', async () => {
      mFindOne.mockResolvedValue(null);

      await expect(service.remove('user-1', 'addr-9')).rejects.toThrow(NotFoundException);
      expect(mDelete).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s for someone else’s address', async () => {
      mFindOne.mockResolvedValue(null);

      await expect(service.update('user-1', 'addr-9', { city: 'Delhi' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('applies the provided fields', async () => {
      const address = makeAddress();
      mFindOne.mockResolvedValue(address);

      const result = await service.update('user-1', 'addr-1', { city: 'Delhi' });

      expect(result.city).toBe('Delhi');
    });

    it('ignores an attempt to demote via PATCH', async () => {
      // Allowing isDefault:false here would leave the user with no default.
      const address = makeAddress({ isDefault: true });
      mFindOne.mockResolvedValue(address);

      const result = await service.update('user-1', 'addr-1', { isDefault: false });

      expect(result.isDefault).toBe(true);
    });

    it('promotes when isDefault:true is sent', async () => {
      const address = makeAddress();
      mFindOne.mockResolvedValue(address);

      const result = await service.update('user-1', 'addr-1', { isDefault: true });

      expect(result.isDefault).toBe(true);
      expect(mUpdate).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('404s rather than 403s for another user’s address', async () => {
      // A 403 confirms the id exists, which is enough to enumerate.
      repoFindOne.mockResolvedValue(null);

      await expect(service.get('user-1', 'addr-9')).rejects.toThrow(NotFoundException);
    });
  });
});
