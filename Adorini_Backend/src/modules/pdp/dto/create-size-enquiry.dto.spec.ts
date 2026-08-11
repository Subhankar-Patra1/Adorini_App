import { createSizeEnquirySchema } from './create-size-enquiry.dto';

describe('createSizeEnquirySchema', () => {
  const valid = { requestedSize: '50', contactPhone: '9876543210' };

  it('prefixes a bare 10-digit Indian mobile with the country code', () => {
    expect(createSizeEnquirySchema.parse(valid).contactPhone).toBe('919876543210');
  });

  it.each(['+91 98765 43210', '+919876543210', '91-98765-43210'])(
    'normalises %s to the same stored value',
    (input) => {
      const parsed = createSizeEnquirySchema.parse({ ...valid, contactPhone: input });
      expect(parsed.contactPhone).toBe('919876543210');
    },
  );

  it.each(['12345', '', 'not-a-phone', '1234567890123456'])('rejects %s', (input) => {
    expect(() => createSizeEnquirySchema.parse({ ...valid, contactPhone: input })).toThrow();
  });

  it('trims the requested size and rejects an empty one', () => {
    expect(createSizeEnquirySchema.parse({ ...valid, requestedSize: '  50  ' }).requestedSize).toBe(
      '50',
    );
    expect(() => createSizeEnquirySchema.parse({ ...valid, requestedSize: '   ' })).toThrow();
  });

  it('accepts free-text sizes, since the point is being out of the stocked band', () => {
    const parsed = createSizeEnquirySchema.parse({
      ...valid,
      requestedSize: 'custom 46, longer sleeves',
    });
    expect(parsed.requestedSize).toBe('custom 46, longer sleeves');
  });

  it('rejects a message longer than the column allows', () => {
    expect(() =>
      createSizeEnquirySchema.parse({ ...valid, message: 'x'.repeat(1001) }),
    ).toThrow();
  });
});
