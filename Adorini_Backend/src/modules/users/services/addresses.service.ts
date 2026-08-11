import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';

import { Address } from '../../../database/entities';

export interface AddressInput {
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    private readonly dataSource: DataSource,
  ) {}

  /** Default first, then newest — the order the checkout screen wants. */
  async list(userId: string): Promise<Address[]> {
    return this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async get(userId: string, addressId: string): Promise<Address> {
    return this.requireOwned(userId, addressId);
  }

  /**
   * Creates an address.
   *
   * The first address a user saves is forced to be the default — otherwise a
   * buyer with exactly one address would have no default, and checkout would
   * have nothing to preselect.
   */
  async create(userId: string, input: AddressInput): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const existingCount = await manager.count(Address, { where: { userId } });
      const shouldBeDefault = input.isDefault === true || existingCount === 0;

      if (shouldBeDefault) {
        await manager.update(Address, { userId }, { isDefault: false });
      }

      const address = manager.create(Address, {
        ...input,
        line2: input.line2 ?? null,
        userId,
        isDefault: shouldBeDefault,
      });

      return manager.save(Address, address);
    });
  }

  async update(userId: string, addressId: string, input: Partial<AddressInput>): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(Address, {
        where: { id: addressId, userId },
      });

      if (!address) {
        throw notFound();
      }

      if (input.isDefault === true) {
        await manager.update(Address, { userId, id: Not(addressId) }, { isDefault: false });
        address.isDefault = true;
      }

      // `isDefault` is handled above; demoting via PATCH is deliberately not
      // supported, because it would leave the user with no default at all.
      const rest = { ...input };
      delete rest.isDefault;
      Object.assign(address, rest);

      return manager.save(Address, address);
    });
  }

  /**
   * Promotes one address to default.
   *
   * There is no database constraint enforcing "exactly one default per user"
   * (a partial unique index would be possible but blocks the swap), so the
   * demote-then-promote pair runs in a transaction. Without it, a failure
   * between the two statements leaves the user with zero defaults and an
   * unexplained blank at checkout.
   */
  async setDefault(userId: string, addressId: string): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(Address, {
        where: { id: addressId, userId },
      });

      if (!address) {
        throw notFound();
      }

      await manager.update(Address, { userId, id: Not(addressId) }, { isDefault: false });
      address.isDefault = true;

      return manager.save(Address, address);
    });
  }

  /**
   * Deletes an address, promoting the most recent survivor if the default was
   * removed — again so the user is never left without one.
   */
  async remove(userId: string, addressId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(Address, {
        where: { id: addressId, userId },
      });

      if (!address) {
        throw notFound();
      }

      await manager.delete(Address, { id: addressId, userId });

      if (!address.isDefault) {
        return;
      }

      const replacement = await manager.findOne(Address, {
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      if (replacement) {
        await manager.update(Address, { id: replacement.id }, { isDefault: true });
      }
    });
  }

  /**
   * Loads an address scoped to its owner.
   *
   * Scoping happens in the WHERE clause, never as a check after loading — and
   * another user's address returns 404, not 403. A 403 would confirm the id
   * exists, which is enough to enumerate how many addresses the system holds.
   */
  private async requireOwned(userId: string, addressId: string): Promise<Address> {
    const address = await this.addresses.findOne({ where: { id: addressId, userId } });

    if (!address) {
      throw notFound();
    }

    return address;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException('Address not found');
}
