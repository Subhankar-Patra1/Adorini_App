import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';
import { looksLikePlaceholder } from '../../config/env.validation';
import { UpstreamTimeoutError, fetchWithTimeout } from '../../common/http/fetch-with-timeout';

const GRAPH_BASE_URL = 'https://graph.facebook.com';

/**
 * OTP delivery is on the critical path of a COD checkout, so it gets a tighter
 * deadline than the default — a buyer staring at a spinner needs an error and a
 * retry button faster than ten seconds.
 */
const WHATSAPP_TIMEOUT_MS = 7_000;

/** Meta rejected the request, was unreachable, or timed out. */
export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'WhatsAppProviderError';
  }
}

interface GraphApiMessageResponse {
  messages?: { id?: string }[];
  error?: { message?: string; type?: string; code?: number };
}

interface TemplateComponent {
  type: 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters: { type: string; text: string }[];
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly otpTemplateName: string;
  private readonly templateLanguage: string;
  private readonly logOtpInsteadOfSending: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.accessToken = config.get('WHATSAPP_ACCESS_TOKEN', { infer: true });
    this.phoneNumberId = config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    this.apiVersion = config.get('WHATSAPP_API_VERSION', { infer: true });
    this.otpTemplateName = config.get('WHATSAPP_OTP_TEMPLATE_NAME', { infer: true });
    this.templateLanguage = config.get('WHATSAPP_TEMPLATE_LANGUAGE', { infer: true });

    /**
     * Local-development seam: with placeholder Meta credentials no WhatsApp
     * message can ever arrive, so every guarded route is unreachable because
     * nobody can complete a login. Printing the code to the server console
     * keeps the authenticated half of the app testable before real
     * credentials are wired in.
     *
     * Safe by construction rather than by discipline: `validateEnv` already
     * refuses to boot production when `WHATSAPP_ACCESS_TOKEN` or
     * `WHATSAPP_PHONE_NUMBER_ID` look like placeholders, so the condition
     * below cannot be true in a production process. The explicit NODE_ENV
     * check is belt-and-braces — it keeps this branch dead in production
     * even if that secrets list is ever narrowed.
     */
    const nodeEnv = config.get('NODE_ENV', { infer: true });
    this.logOtpInsteadOfSending =
      nodeEnv !== 'production' &&
      (looksLikePlaceholder(this.accessToken) || looksLikePlaceholder(this.phoneNumberId));

    if (this.logOtpInsteadOfSending) {
      this.logger.warn(
        'Meta WhatsApp credentials are placeholders — OTPs will be printed to this console instead of sent over WhatsApp. Never expected outside local development.',
      );
    }
  }

  /**
   * Sends an OTP over WhatsApp using the approved Authentication-category
   * template.
   *
   * ⚠️ KNOWN GAP: this is the *only* OTP delivery channel. MSG91 and its SMS
   * fallback have been dropped entirely — a phone number with no active
   * WhatsApp account cannot receive a code and therefore cannot log in or
   * complete a COD checkout. Meta's Cloud API returns a real error object for
   * an undeliverable send (unlike MSG91's OTP endpoint, which reported
   * success unconditionally), so this at least fails loudly rather than
   * silently — but there is currently no fallback channel and no
   * product-level messaging telling such a user why they're stuck. Accepted
   * as a deliberate trade-off for this migration, not an oversight.
   *
   * ⚠️ UNVERIFIED AGAINST A LIVE TEMPLATE: sends the code as a single body
   * parameter only. If the approved template also has a one-tap
   * autofill/copy-code button component, Meta will reject this send until a
   * matching `button` component is added — check WhatsApp Manager → Message
   * Templates for the template's actual structure before the first live
   * send. A one-tap autofill button needs
   * `{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] }`;
   * a copy-code button needs `sub_type: 'copy_code'` with a
   * `{ type: 'coupon_code', coupon_code: otp }` parameter instead.
   */
  async sendOtp(phone: string, otp: string): Promise<void> {
    if (this.logOtpInsteadOfSending) {
      this.logDevOtp(phone, otp);
      return;
    }

    const components: TemplateComponent[] = [
      { type: 'body', parameters: [{ type: 'text', text: otp }] },
    ];

    await this.sendTemplate(phone, this.otpTemplateName, components, 'sendOtp');
  }

  /**
   * Sends a body-only templated WhatsApp notification (e.g. the
   * failed-delivery reattempt prompt).
   *
   * `bodyParams`' iteration order maps positionally to the template's
   * `{{1}}, {{2}}, ...` placeholders — the object's keys are cosmetic labels
   * only, Meta cares about position, not name.
   */
  async notifyTemplate(
    phone: string,
    templateName: string,
    bodyParams: Record<string, string>,
  ): Promise<void> {
    const parameters = Object.values(bodyParams).map((text) => ({ type: 'text', text }));
    const components: TemplateComponent[] = parameters.length ? [{ type: 'body', parameters }] : [];

    await this.sendTemplate(phone, templateName, components, 'notifyTemplate');
  }

  private async sendTemplate(
    phone: string,
    templateName: string,
    components: TemplateComponent[],
    operation: string,
  ): Promise<void> {
    const url = `${GRAPH_BASE_URL}/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: this.templateLanguage },
        components,
      },
    };

    const response = await this.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      operation,
    );
    const body = await this.readJson(response, operation);

    // Meta returns a real error object — `{ error: { message, type, code } }`
    // — on rejection, unlike MSG91's HTTP-200-even-on-failure quirk. Trust it.
    if (body.error) {
      this.logger.error(`Meta ${operation} rejected: ${body.error.message}`);
      throw new WhatsAppProviderError(
        `Meta rejected the ${operation} request: ${body.error.message ?? 'unknown reason'}`,
        response.status,
        body,
      );
    }

    this.logger.log(
      `Meta accepted WhatsApp ${operation} for ${this.maskPhone(phone)} (message id: ${body.messages?.[0]?.id ?? 'not returned'})`,
    );
  }

  /** Issues a request and throws `WhatsAppProviderError` on any non-2xx or transport failure. */
  private async request(url: string, init: RequestInit, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          ...init,
          headers: { authorization: `Bearer ${this.accessToken}`, ...(init.headers ?? {}) },
        },
        WHATSAPP_TIMEOUT_MS,
      );
    } catch (error) {
      throw this.toProviderError(error, operation);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '<unreadable body>');
      this.logger.error(`Meta ${operation} failed [${response.status}]: ${errText}`);
      throw new WhatsAppProviderError(
        `Meta ${operation} failed: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    return response;
  }

  /**
   * Meta occasionally answers with a non-JSON body (edge/proxy error pages).
   * Treat that as an empty payload rather than letting a parse error
   * masquerade as a network fault.
   */
  private async readJson(response: Response, operation: string): Promise<GraphApiMessageResponse> {
    try {
      return (await response.json()) as GraphApiMessageResponse;
    } catch {
      this.logger.warn(`Meta ${operation} returned a non-JSON body`);
      return {};
    }
  }

  private toProviderError(error: unknown, operation: string): WhatsAppProviderError {
    if (error instanceof UpstreamTimeoutError) {
      this.logger.error(`Meta ${operation} timed out after ${error.timeoutMs}ms`);
      return new WhatsAppProviderError(`Meta ${operation} timed out`, undefined, error);
    }

    this.logger.error(`Meta ${operation} was unreachable`, error);
    return new WhatsAppProviderError(`Meta ${operation} was unreachable`, undefined, error);
  }

  /**
   * Prints the login code to the server console in place of a WhatsApp
   * message.
   *
   * The phone stays masked as everywhere else, but the code itself is printed
   * in full — a masked code would defeat the entire purpose. This runs only on
   * the placeholder-credential path guarded in the constructor.
   */
  private logDevOtp(phone: string, otp: string): void {
    this.logger.warn(
      `[DEV OTP] ${this.maskPhone(phone)} -> ${otp}  (no WhatsApp message sent; placeholder Meta credentials)`,
    );
  }

  /** Phone numbers are personal data; logs get the last four digits only. */
  private maskPhone(phone: string): string {
    return phone.length <= 4 ? '****' : `****${phone.slice(-4)}`;
  }
}
