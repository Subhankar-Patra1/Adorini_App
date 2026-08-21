import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SearchQuery } from '../../../database/entities/search-query.entity';

export interface SearchTermReportRow {
  term: string;
  searches: number;
  /** Most recent result count seen for this term. */
  latestResultCount: number;
  lastSearchedAt: Date;
}

export interface SearchAnalyticsReport {
  windowDays: number;
  totalSearches: number;
  /** Searches that returned nothing, as a share of the total. */
  zeroResultRate: number;
  topTerms: SearchTermReportRow[];
  /** The buying list: what shoppers ask for and the shop does not have. */
  unmetDemand: SearchTermReportRow[];
}

/**
 * Reads the search log.
 *
 * Two questions, deliberately reported separately:
 *
 * - **Top terms** tell you what to put on the home screen and which categories
 *   deserve to lead the rail.
 * - **Unmet demand** — terms that returned zero — tells you what to buy. That
 *   is the one this table exists for; a term searched thirty times with no
 *   results is a stock decision that would otherwise never surface, because the
 *   shoppers who wanted it simply left.
 */
@Injectable()
export class SearchAnalyticsService {
  constructor(
    @InjectRepository(SearchQuery)
    private readonly searchQueryRepo: Repository<SearchQuery>,
  ) {}

  async report(windowDays = 30, limit = 20): Promise<SearchAnalyticsReport> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // One grouped pass; the report is small and read rarely, so the clarity of
    // a single query beats shaving a round trip.
    const rows = await this.searchQueryRepo
      .createQueryBuilder('sq')
      .select('sq.normalisedTerm', 'term')
      .addSelect('COUNT(*)::int', 'searches')
      // The same term can return different counts over time as stock changes;
      // the newest is the only one that describes the shop as it is now.
      .addSelect(
        '(ARRAY_AGG(sq.result_count ORDER BY sq.created_at DESC))[1]',
        'latestResultCount',
      )
      .addSelect('MAX(sq.created_at)', 'lastSearchedAt')
      .where('sq.created_at >= :since', { since })
      .groupBy('sq.normalisedTerm')
      .orderBy('searches', 'DESC')
      .addOrderBy('"lastSearchedAt"', 'DESC')
      .getRawMany<{
        term: string;
        searches: number;
        latestResultCount: number;
        lastSearchedAt: Date;
      }>();

    const totalSearches = rows.reduce((sum, row) => sum + Number(row.searches), 0);
    const zeroResultSearches = rows
      .filter((row) => Number(row.latestResultCount) === 0)
      .reduce((sum, row) => sum + Number(row.searches), 0);

    const normalise = (row: (typeof rows)[number]): SearchTermReportRow => ({
      term: row.term,
      searches: Number(row.searches),
      latestResultCount: Number(row.latestResultCount),
      lastSearchedAt: row.lastSearchedAt,
    });

    return {
      windowDays,
      totalSearches,
      zeroResultRate: totalSearches === 0 ? 0 : zeroResultSearches / totalSearches,
      topTerms: rows.slice(0, limit).map(normalise),
      unmetDemand: rows
        .filter((row) => Number(row.latestResultCount) === 0)
        .slice(0, limit)
        .map(normalise),
    };
  }
}
