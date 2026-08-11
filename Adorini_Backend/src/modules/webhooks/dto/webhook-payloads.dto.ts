import { z } from 'zod';

/**
 * Inbound webhook payloads, parsed defensively.
 *
 * Every schema is `passthrough`: providers add fields without warning, and a
 * strict schema would start rejecting live payment callbacks the day Cashfree
 * ships a new attribute. Only the fields actually acted on are required — the
 * rest is retained verbatim in `processed_webhooks.payload` for disputes.
 */

/** Cashfree PG v2 webhook. */
export const cashfreeWebhookSchema = z
  .object({
    type: z.string().min(1),
    data: z
      .object({
        order: z.object({ order_id: z.string().min(1) }).loose(),
        payment: z
          .object({
            cf_payment_id: z.union([z.string(), z.number()]).optional(),
            payment_status: z.string().optional(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();

export type CashfreeWebhookPayload = z.infer<typeof cashfreeWebhookSchema>;

/**
 * Delhivery status push. `Status.StatusType` is the coded field and what we map
 * on; `Status.Status` is human prose that varies by account configuration.
 */
export const delhiveryWebhookSchema = z
  .object({
    Shipment: z
      .object({
        AWB: z.string().min(1),
        Status: z
          .object({
            Status: z.string().optional(),
            StatusType: z.string().optional(),
            StatusDateTime: z.string().optional(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();

export type DelhiveryWebhookPayload = z.infer<typeof delhiveryWebhookSchema>;

/**
 * MSG91 delivery report. Ingested for the audit trail only — nothing downstream
 * branches on whether an OTP SMS was delivered, since the OTP flow is driven by
 * the user entering the code, not by the carrier receipt.
 */
export const msg91WebhookSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    message_id: z.string().min(1).optional(),
    report: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose()
  .refine((p) => Boolean(p.requestId ?? p.message_id), {
    error: 'MSG91 payload must carry a requestId or message_id to be de-duplicated',
  });

export type Msg91WebhookPayload = z.infer<typeof msg91WebhookSchema>;
