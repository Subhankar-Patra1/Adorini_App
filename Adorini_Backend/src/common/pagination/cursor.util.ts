import { BadRequestException } from '@nestjs/common';

export interface SeekCursor {
  /** String form of whatever column the current sort orders by (ISO date or stringified integer). */
  sortValue: string;
  id: string;
}

/**
 * Opaque seek-pagination cursor, shared by every infinite-scroll feed
 * (catalog grid, PDP reviews).
 *
 * Base64url of a small JSON pair rather than a raw offset: a row inserted or
 * removed between two page requests shifts every subsequent `LIMIT..OFFSET`
 * page, so an offset-paginated feed skips or repeats items mid-scroll —
 * precisely what infinite scroll is meant to hide (see ADR-028).
 */
export function encodeCursor(cursor: SeekCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): SeekCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as SeekCursor).sortValue !== 'string' ||
      typeof (parsed as SeekCursor).id !== 'string'
    ) {
      throw new Error('malformed cursor payload');
    }
    return parsed as SeekCursor;
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
