import { z } from 'zod';

/**
 * MSG91's inbound WhatsApp callback.
 *
 * `loose()` throughout for the same reason every other provider payload is:
 * MSG91 adds fields without notice, and a strict schema would start rejecting
 * live buyer replies the day they do.
 *
 * ⚠️ Shape written from MSG91's published inbound-webhook docs and **not**
 * verified against a live account — MSG91 credentials are still pending. The
 * two fields this actually depends on are the sender's phone and the message
 * text; both are read defensively via `pickInboundMessage` below so a shape
 * change surfaces as a clear 400 rather than a crash.
 */
export const whatsappInboundSchema = z
  .object({
    /** MSG91's own id for the inbound message — the de-duplication key. */
    message_id: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    /** Sender, in international format without `+`. */
    from: z.string().min(1).optional(),
    mobile: z.string().min(1).optional(),
    /** The reply body, under one of several shapes depending on message type. */
    text: z.union([z.string(), z.object({ body: z.string() }).loose()]).optional(),
    body: z.string().optional(),
    button: z.object({ text: z.string().optional(), payload: z.string().optional() }).loose().optional(),
  })
  .loose();

export type WhatsappInboundPayload = z.infer<typeof whatsappInboundSchema>;

export interface InboundMessage {
  messageId: string;
  fromPhone: string;
  text: string;
}

/**
 * Normalises MSG91's several possible inbound shapes into the three things this
 * module needs. Returns null when any of them is missing, which the controller
 * turns into a 400 — a payload we cannot attribute to a sender is not something
 * retrying will fix.
 */
export function pickInboundMessage(payload: WhatsappInboundPayload): InboundMessage | null {
  const messageId = payload.message_id ?? payload.messageId;
  const fromPhone = payload.from ?? payload.mobile;

  // A quick-reply button press carries its label rather than a text body, and
  // is the shape a "Yes, try again" button produces.
  const text =
    payload.button?.text ??
    payload.button?.payload ??
    (typeof payload.text === 'string' ? payload.text : payload.text?.body) ??
    payload.body;

  if (!messageId || !fromPhone || !text) {
    return null;
  }

  return { messageId, fromPhone, text };
}
