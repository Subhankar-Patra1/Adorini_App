import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from './base.entity';

/**
 * One catalogue search, logged for merchandising.
 *
 * The point of this table is **`resultCount = 0`**. A shopper searching for
 * something the shop does not stock is the clearest buying signal available:
 * forty searches for "saree" in a month is a demand statement no survey would
 * get you. That data only exists going forward, which is why this is worth
 * having before launch rather than after.
 *
 * ### Deliberately not linked to a user
 *
 * There is no `userId`. Search terms are unusually revealing — sizes, body
 * shape, occasions, gifts — and attaching them to an identity turns a
 * merchandising aid into a behavioural profile of named customers, which is a
 * different thing to hold and a different thing to be breached. Every question
 * this table is meant to answer ("what do people look for", "what do we not
 * stock") is answerable from anonymous rows.
 */
@Index('idx_search_queries_normalised', ['normalisedTerm'])
@Index('idx_search_queries_created_at', ['createdAt'])
@Entity('search_queries')
export class SearchQuery extends BaseEntity {
  /** Exactly what was typed, for reading back in the admin report. */
  @Column({ type: 'varchar', length: 120 })
  term: string;

  /**
   * Lower-cased and whitespace-collapsed, so "Kurti", "kurti" and " kurti "
   * aggregate into one row in the report instead of three near-identical ones.
   */
  @Column({ type: 'varchar', length: 120 })
  normalisedTerm: string;

  /** How many products came back. Zero is the interesting case. */
  @Column({ type: 'integer' })
  resultCount: number;
}
