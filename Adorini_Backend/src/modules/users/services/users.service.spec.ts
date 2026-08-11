import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';

import { UsersService } from './users.service';
import { Referral, User } from '../../../database/entities';
import { ReferralStatus } from '../../../common/enums/domain.enums';

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('UPDATE', [], new Error('duplicate key'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    phone: '919876543210',
    email: null,
    fullName: null,
    gender: null,
    profilePhotoKey: null,
    googleId: null,
    isPhoneVerified: true,
    isAdmin: false,
    referralCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

describe('UsersService', () => {
  let service: UsersService;
  let usersFindOne: jest.Mock;
  let usersSave: jest.Mock;
  let usersUpdate: jest.Mock;
  let referralsFind: jest.Mock;

  beforeEach(async () => {
    usersFindOne = jest.fn().mockResolvedValue(makeUser());
    usersSave = jest.fn().mockImplementation((u: User) => Promise.resolve(u));
    usersUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    referralsFind = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: usersFindOne, save: usersSave, update: usersUpdate },
        },
        { provide: getRepositoryToken(Referral), useValue: { find: referralsFind } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getProfile', () => {
    it('returns the public shape, not the entity', async () => {
      usersFindOne.mockResolvedValue(makeUser({ googleId: 'g-1', isAdmin: true }));

      const profile = await service.getProfile('user-1');

      expect(profile.hasGoogleLinked).toBe(true);
      // isAdmin is internal — it must not leak into a buyer-facing payload.
      expect(profile).not.toHaveProperty('isAdmin');
      expect(profile).not.toHaveProperty('referralCode');
    });

    it('404s when the account is gone', async () => {
      // Reachable with a still-valid access token for a deleted account: the
      // token is stateless and outlives deletion by up to 15 minutes.
      usersFindOne.mockResolvedValue(null);

      await expect(service.getProfile('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates only the fields provided', async () => {
      const user = makeUser({ fullName: 'Old Name', gender: 'female' });
      usersFindOne.mockResolvedValue(user);

      await service.updateProfile('user-1', { fullName: 'New Name' });

      expect(user.fullName).toBe('New Name');
      expect(user.gender).toBe('female');
    });

    it('clears a field when null is sent explicitly', async () => {
      const user = makeUser({ fullName: 'Old Name' });
      usersFindOne.mockResolvedValue(user);

      await service.updateProfile('user-1', { fullName: null });

      expect(user.fullName).toBeNull();
    });

    it('reports an email collision as a conflict, not a 500', async () => {
      usersSave.mockRejectedValue(uniqueViolation());

      await expect(service.updateProfile('user-1', { email: 'taken@example.com' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('cannot change the phone number', async () => {
      const user = makeUser();
      usersFindOne.mockResolvedValue(user);

      // Phone identifies the account; changing it is an OTP-verified flow.
      await service.updateProfile('user-1', {
        phone: '919999999999',
      } as unknown as { fullName?: string });

      expect(user.phone).toBe('919876543210');
    });
  });

  describe('getOrCreateReferralCode', () => {
    it('returns the existing code without minting a new one', async () => {
      usersFindOne.mockResolvedValue(makeUser({ referralCode: 'EXISTING' }));

      await expect(service.getOrCreateReferralCode('user-1')).resolves.toEqual({
        referralCode: 'EXISTING',
      });
      expect(usersUpdate).not.toHaveBeenCalled();
    });

    it('mints a code on first request', async () => {
      const { referralCode } = await service.getOrCreateReferralCode('user-1');

      expect(referralCode).toHaveLength(8);
      expect(usersUpdate).toHaveBeenCalledWith({ id: 'user-1' }, { referralCode });
    });

    it('avoids characters that get misread when a code is shared', async () => {
      // Codes are read aloud and typed from screenshots; O/0 and I/1/L cost a
      // referral credit and a support message every time they are confused.
      for (let i = 0; i < 40; i++) {
        const { referralCode } = await service.getOrCreateReferralCode('user-1');
        expect(referralCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      }
    });

    it('retries on a collision', async () => {
      usersUpdate.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ affected: 1 });

      await expect(service.getOrCreateReferralCode('user-1')).resolves.toHaveProperty(
        'referralCode',
      );
      expect(usersUpdate).toHaveBeenCalledTimes(2);
    });

    it('gives up rather than looping forever', async () => {
      usersUpdate.mockRejectedValue(uniqueViolation());

      await expect(service.getOrCreateReferralCode('user-1')).rejects.toThrow(
        /unique referral code/i,
      );
    });
  });

  describe('listReferrals', () => {
    it('returns status and amounts but never identifies the referee', async () => {
      // Sharing a code does not entitle you to the contact details of everyone
      // who used it.
      referralsFind.mockResolvedValue([
        {
          id: 'ref-1',
          status: ReferralStatus.PENDING,
          creditPaise: 10000,
          createdAt: new Date(),
          creditedAt: null,
          refereePhone: '919876500001',
          refereeId: 'user-2',
        },
      ]);

      const [summary] = await service.listReferrals('user-1');

      expect(summary.status).toBe(ReferralStatus.PENDING);
      expect(summary).not.toHaveProperty('refereePhone');
      expect(summary).not.toHaveProperty('refereeId');
    });

    it('scopes the query to the caller', async () => {
      await service.listReferrals('user-1');

      expect(referralsFind).toHaveBeenCalledWith(
        expect.objectContaining({ where: { referrerId: 'user-1' } }),
      );
    });
  });
});
