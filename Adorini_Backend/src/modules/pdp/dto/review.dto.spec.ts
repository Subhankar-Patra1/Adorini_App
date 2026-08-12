import { FitTag } from '../../../common/enums/domain.enums';
import { createReviewSchema } from './review.dto';

describe('createReviewSchema', () => {
  it('coerces multipart string fields to their real types', () => {
    const parsed = createReviewSchema.parse({
      rating: '4',
      fitTag: FitTag.RUNS_SMALL,
      purchasedNominalSize: '42',
    });

    expect(parsed).toEqual({
      rating: 4,
      fitTag: FitTag.RUNS_SMALL,
      purchasedNominalSize: 42,
    });
  });

  it('accepts a rating with no other fields', () => {
    expect(() => createReviewSchema.parse({ rating: 3 })).not.toThrow();
  });

  it.each(['0', '6', 'not-a-number'])('rejects an out-of-range or invalid rating %s', (rating) => {
    expect(() => createReviewSchema.parse({ rating })).toThrow();
  });

  it('rejects a nominal size outside the stocked 40–48 band', () => {
    expect(() => createReviewSchema.parse({ rating: '5', purchasedNominalSize: '50' })).toThrow();
  });

  it('rejects an unknown fit tag', () => {
    expect(() => createReviewSchema.parse({ rating: '5', fitTag: 'SOMEWHAT_OK' })).toThrow();
  });

  it('trims the body and rejects one over the column limit', () => {
    expect(createReviewSchema.parse({ rating: '5', body: '  nice  ' }).body).toBe('nice');
    expect(() => createReviewSchema.parse({ rating: '5', body: 'x'.repeat(2001) })).toThrow();
  });
});
