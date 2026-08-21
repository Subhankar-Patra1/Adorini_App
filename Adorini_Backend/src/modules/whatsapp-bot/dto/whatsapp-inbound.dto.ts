import { z } from 'zod';

/**
 * Meta's WhatsApp Cloud API inbound webhook envelope.
 *
 * `.loose()` throughout for the same reason every other provider payload is:
 * Meta adds fields without notice, and a strict schema would start rejecting
 * live buyer replies the day they do.
 *
 * Both actual inbound messages (`messages[]`) and delivery-status receipts
 * (`statuses[]` — sent/delivered/read/failed) arrive on this same webhook URL.
 * Only `messages[]` is read here; a `statuses[]`-only payload is a normal,
 * frequent, expected shape, not an error — see `pickInboundMessage`.
 *
 * ⚠️ Shape written from Meta's published Cloud API webhook docs and **not**
 * verified against a live account. The fields this actually depends on are
 * the message id, the sender's phone, and the reply text; all are read
 * defensively so a shape change surfaces as an "ignored" outcome rather than a
 * crash.
 */
const inboundMessageSchema = z
  .object({
    /** Meta's own id for the inbound message (`wamid...`) — the de-duplication key. */
    id: z.string().min(1).optional(),
    /** Sender, in international format without `+`. */
    from: z.string().min(1).optional(),
    type: z.string().optional(),
    /** Plain-text reply body. */
    text: z.object({ body: z.string() }).loose().optional(),
    /** Legacy quick-reply button press. */
    button: z
      .object({ text: z.string().optional(), payload: z.string().optional() })
      .loose()
      .optional(),
    /** Modern interactive quick-reply button press. */
    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z
          .object({ id: z.string().optional(), title: z.string().optional() })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const changeValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    messages: z.array(inboundMessageSchema).optional(),
    /** Delivery-status receipts — never actioned, just distinguished from `messages[]`. */
    statuses: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

export const whatsappInboundSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            id: z.string().optional(),
            changes: z
              .array(z.object({ field: z.string().optional(), value: changeValueSchema }).loose())
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

export type WhatsappInboundPayload = z.infer<typeof whatsappInboundSchema>;

export interface InboundMessage {
  messageId: string;
  fromPhone: string;
  text: string;
}

/**
 * Extracts the one inbound message this bot cares about from Meta's webhook
 * envelope, or null when there is nothing actionable — most commonly because
 * this delivery is a `statuses[]` receipt, not an inbound message at all.
 * Both shapes arrive on the same URL; this is the only place that tells them
 * apart, matching this function's role of being the sole seam between the
 * wire format and the rest of the module.
 */
export function pickInboundMessage(payload: WhatsappInboundPayload): InboundMessage | null {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const message = change.value?.messages?.[0];

      if (!message) {
        continue; // statuses-only change, or an empty one — not an error.
      }

      const messageId = message.id;
      const fromPhone = message.from;

      // A quick-reply button press carries its label rather than a text body,
      // and is the shape a "Yes, try again" button produces — under either
      // the legacy `button` field or the modern `interactive.button_reply`.
      const text =
        message.button?.text ??
        message.button?.payload ??
        message.interactive?.button_reply?.title ??
        message.interactive?.button_reply?.id ??
        message.text?.body;

      if (messageId && fromPhone && text) {
        return { messageId, fromPhone, text };
      }
    }
  }

  return null;
}
