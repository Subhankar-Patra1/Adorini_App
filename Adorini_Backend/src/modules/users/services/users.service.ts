import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { QueryFailedError, Repository } from 'typeorm';

import { Referral, User } from '../../../database/entities';
import { toPublicUser, type PublicUser } from '../../auth/services/auth.service';
import type { ReferralStatus } from '../../../common/enums/domain.enums';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Referral-code alphabet with visually ambiguous characters removed.
 *
 * Codes get read aloud, texted, and typed from screenshots, so `0`/`O` and
 * `1`/`I`/`L` are excluded — a code that is routinely mistyped costs a referral
 * credit and generates a support message.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 5;

export interface ReferralSummary {
  id: string;
  status: ReferralStatus;
  creditPaise: number;
  createdAt: Date;
  creditedAt: Date | null;
}

export interface UpdateProfileInput {
  fullName?: string | null;
  email?: string | null;
  gender?: string | null;
  profilePhotoKey?: string | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
  ) {}

  async getProfile(userId: string): Promise<PublicUser> {
    return toPublicUser(await this.requireUser(userId));
  }

  /**
   * Updates editable profile fields.
   *
   * `phone` is deliberately absent: it is the account's identity, and changing
   * it has to go through OTP verification of the new number rather than a
   * profile PATCH.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    const user = await this.requireUser(userId);

    // Only apply keys actually present, so a PATCH omitting a field leaves it
    // alone while one explicitly sending null clears it.
    if ('fullName' in input) user.fullName = input.fullName ?? null;
    if ('gender' in input) user.gender = input.gender ?? null;
    if ('profilePhotoKey' in input) user.profilePhotoKey = input.profilePhotoKey ?? null;
    if ('email' in input) user.email = input.email ?? null;

    try {
      return toPublicUser(await this.users.save(user));
    } catch (error) {
      if (isUniqueViolation(error)) {
        // `users.email` is partial-unique. Named explicitly rather than left to
        // the filter's generic "already in use", so the client can point at the
        // right field.
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'That email address is already in use.',
        });
      }
      throw error;
    }
  }

  /**
   * Returns the user's referral code, minting one on first request.
   *
   * Minted lazily rather than at signup because most accounts never share a
   * code, and every unused code still occupies the unique index.
   */
  async getOrCreateReferralCode(userId: string): Promise<{ referralCode: string }> {
    const user = await this.requireUser(userId);

    if (user.referralCode) {
      return { referralCode: user.referralCode };
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateReferralCode();

      try {
        await this.users.update({ id: userId }, { referralCode: candidate });
        return { referralCode: candidate };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Collision against the partial unique index — vanishingly unlikely at
        // 31^8, but retried rather than assumed away.
        this.logger.warn(`Referral code collision on attempt ${attempt + 1}`);
      }
    }

    throw new Error('Could not allocate a unique referral code');
  }

  /**
   * The referrals this user has made.
   *
   * Returns status and amounts only — never the referee's phone or name.
   * Someone who shares a code is not entitled to the contact details of
   * everyone who used it.
   */
  async listReferrals(userId: string): Promise<ReferralSummary[]> {
    const rows = await this.referrals.find({
      where: { referrerId: userId },
      order: { createdAt: 'DESC' },
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      creditPaise: row.creditPaise,
      createdAt: row.createdAt,
      creditedAt: row.creditedAt,
    }));
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      // Reachable with a still-valid access token for a deleted account — the
      // token is stateless and lives up to 15 minutes past deletion.
      throw new NotFoundException('Account no longer exists');
    }

    return user;
  }
}

function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';

  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }

  return code;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
