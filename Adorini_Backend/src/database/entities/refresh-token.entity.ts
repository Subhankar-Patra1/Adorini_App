import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { User } from './user.entity';

/**
 * One issued refresh token, stored so sessions can actually be ended.
 *
 * Access tokens are short-lived and stateless; this table is what makes
 * "log out" and "log out everywhere" mean something. A purely stateless scheme
 * cannot revoke anything, which on a COD/payments account is the difference
 * between losing a phone and losing an account.
 *
 * Only the SHA-256 of the token is stored. The raw value exists in exactly two
 * places — the response that issued it and the client holding it — so a dump of
 * this table yields nothing usable.
 */
@Index('idx_refresh_tokens_user_active', ['userId', 'revokedAt'])
@Entity('refresh_tokens')
export class RefreshToken extends BaseEntity {
  @ManyToOne('User', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  /** SHA-256 hex of the raw token. Unique so a hash collision cannot alias sessions. */
  @Index({ unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set when rotated, logged out, or revoked as part of a reuse response. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /**
   * The token that replaced this one on rotation.
   *
   * This is what makes reuse detection possible: a request presenting an
   * already-rotated token means the old value leaked and is being replayed, so
   * the whole chain is revoked rather than just refusing the one request.
   */
  @Column({ type: 'char', length: 64, nullable: true })
  replacedByHash: string | null;

  /** Context for a future "your active sessions" screen. Never used for auth decisions. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** IPv6-safe length. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;
}
