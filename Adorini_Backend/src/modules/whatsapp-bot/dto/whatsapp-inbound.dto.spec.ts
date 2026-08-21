import { pickInboundMessage, whatsappInboundSchema } from './whatsapp-inbound.dto';

function envelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value }] }],
  };
}

function withMessage(message: Record<string, unknown>): Record<string, unknown> {
  return envelope({ messaging_product: 'whatsapp', messages: [message] });
}

describe('whatsapp inbound payload', () => {
  it('accepts unknown extra fields', () => {
    // Meta adds fields without notice; a strict schema would start rejecting
    // live buyer replies the day they do.
    const parsed = whatsappInboundSchema.parse(
      withMessage({
        id: 'wamid.1',
        from: '919876543210',
        text: { body: 'yes' },
        somethingNew: true,
      }),
    );

    expect(parsed.entry?.[0]?.changes?.[0]?.value.messages?.[0]?.id).toBe('wamid.1');
  });

  describe('pickInboundMessage', () => {
    it('reads a plain text body', () => {
      expect(
        pickInboundMessage(withMessage({ id: 'wamid.1', from: '91987', text: { body: 'yes' } })),
      ).toEqual({ messageId: 'wamid.1', fromPhone: '91987', text: 'yes' });
    });

    it('reads a legacy quick-reply button label', () => {
      // What a "Yes, try again" template button produces — no text body at all.
      expect(
        pickInboundMessage(
          withMessage({ id: 'wamid.1', from: '91987', button: { text: 'Yes, try again' } }),
        ),
      ).toEqual({ messageId: 'wamid.1', fromPhone: '91987', text: 'Yes, try again' });
    });

    it('falls back to a legacy button payload when it carries no label', () => {
      expect(
        pickInboundMessage(withMessage({ id: 'wamid.1', from: '91987', button: { payload: '1' } }))
          ?.text,
      ).toBe('1');
    });

    it('reads a modern interactive button-reply title', () => {
      expect(
        pickInboundMessage(
          withMessage({
            id: 'wamid.1',
            from: '91987',
            interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes' } },
          }),
        )?.text,
      ).toBe('Yes');
    });

    it('falls back to the interactive button-reply id when it carries no title', () => {
      expect(
        pickInboundMessage(
          withMessage({
            id: 'wamid.1',
            from: '91987',
            interactive: { type: 'button_reply', button_reply: { id: 'yes' } },
          }),
        )?.text,
      ).toBe('yes');
    });

    it('prefers a button press over a text body when both are present', () => {
      expect(
        pickInboundMessage(
          withMessage({
            id: 'wamid.1',
            from: '91987',
            text: { body: 'ignored' },
            button: { text: 'Yes' },
          }),
        )?.text,
      ).toBe('Yes');
    });

    it('returns null for a statuses[]-only payload — a normal, expected shape, not an error', () => {
      expect(
        pickInboundMessage(
          envelope({
            messaging_product: 'whatsapp',
            statuses: [{ id: 's1', status: 'delivered' }],
          }),
        ),
      ).toBeNull();
    });

    it.each([
      ['no message id', { from: '91987', text: { body: 'yes' } }],
      ['no sender', { id: 'wamid.1', text: { body: 'yes' } }],
      ['no body', { id: 'wamid.1', from: '91987' }],
    ])('returns null with %s', (_label, message) => {
      expect(pickInboundMessage(withMessage(message))).toBeNull();
    });

    it('returns null for an empty envelope', () => {
      expect(pickInboundMessage({})).toBeNull();
    });

    it('walks past a change with no usable message to find one in a later change', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              { field: 'messages', value: { statuses: [{ id: 's1' }] } },
              {
                field: 'messages',
                value: { messages: [{ id: 'wamid.2', from: '91987', text: { body: 'yes' } }] },
              },
            ],
          },
        ],
      };

      expect(pickInboundMessage(payload)).toEqual({
        messageId: 'wamid.2',
        fromPhone: '91987',
        text: 'yes',
      });
    });
  });
});
