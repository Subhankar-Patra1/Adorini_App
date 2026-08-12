import { pickInboundMessage, whatsappInboundSchema } from './whatsapp-inbound.dto';

describe('whatsapp inbound payload', () => {
  it('accepts unknown extra fields', () => {
    // MSG91 adds fields without notice; a strict schema would start rejecting
    // live buyer replies the day they do.
    const parsed = whatsappInboundSchema.parse({
      message_id: 'm1',
      from: '919876543210',
      text: 'yes',
      somethingNew: { nested: true },
    });

    expect(parsed.message_id).toBe('m1');
  });

  describe('pickInboundMessage', () => {
    it('reads a plain string text body', () => {
      expect(pickInboundMessage({ message_id: 'm1', from: '91987', text: 'yes' })).toEqual({
        messageId: 'm1',
        fromPhone: '91987',
        text: 'yes',
      });
    });

    it('reads a nested text object', () => {
      expect(
        pickInboundMessage({ message_id: 'm1', from: '91987', text: { body: 'yes' } }),
      ).toEqual({ messageId: 'm1', fromPhone: '91987', text: 'yes' });
    });

    it('reads a quick-reply button label', () => {
      // What a "Yes, try again" template button produces — no text body at all.
      expect(
        pickInboundMessage({
          message_id: 'm1',
          from: '91987',
          button: { text: 'Yes, try again' },
        }),
      ).toEqual({ messageId: 'm1', fromPhone: '91987', text: 'Yes, try again' });
    });

    it('falls back to a button payload when it carries no label', () => {
      expect(
        pickInboundMessage({ message_id: 'm1', from: '91987', button: { payload: '1' } })?.text,
      ).toBe('1');
    });

    it('accepts the alternative field spellings', () => {
      expect(pickInboundMessage({ messageId: 'm2', mobile: '91988', body: 'no' })).toEqual({
        messageId: 'm2',
        fromPhone: '91988',
        text: 'no',
      });
    });

    it('prefers a button press over a text body when both are present', () => {
      expect(
        pickInboundMessage({
          message_id: 'm1',
          from: '91987',
          text: 'ignored',
          button: { text: 'Yes' },
        })?.text,
      ).toBe('Yes');
    });

    it.each([
      ['no message id', { from: '91987', text: 'yes' }],
      ['no sender', { message_id: 'm1', text: 'yes' }],
      ['no body', { message_id: 'm1', from: '91987' }],
      ['nothing at all', {}],
    ])('returns null with %s', (_label, payload) => {
      expect(pickInboundMessage(payload)).toBeNull();
    });
  });
});
