import { BadRequestException } from '@nestjs/common';

import { decodeCursor, encodeCursor } from './cursor.util';

describe('cursor.util', () => {
  it('round-trips a cursor through encode/decode', () => {
    const cursor = { sortValue: '129900', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
  });

  it('rejects a cursor missing required fields', () => {
    const malformed = Buffer.from(JSON.stringify({ sortValue: '1' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });
});
