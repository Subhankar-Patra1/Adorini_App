import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';
import { looksLikePlaceholder } from '../../config/env.validation';
import { UpstreamTimeoutError, fetchWithTimeout } from '../../common/http/fetch-with-timeout';

const MSG91_BASE_URL = 'https://control.msg91.com/api/v5';

/**
 * OTP delivery is on the critical path of a COD checkout, so it gets a tighter
 * deadline than the default — a buyer staring at a spinner needs an error and a
 * retry button faster than ten seconds.
 */
const SMS_TIMEOUT_MS = 7_000;

/** MSG91 rejected the request, was unreachable, or timed out. */
export class SmsProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'SmsProviderError';
  }
}

interface Msg91Response {
  type?: string;
  message?: string;
  request_id?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly authKey: string;
  private readonly otpTemplateId: string;
  private readonly whatsappNumber: string;
  private readonly logOtpInsteadOfSending: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.authKey = config.get('MSG91_AUTH_KEY', { infer: true });
    this.otpTemplateId = config.get('MSG91_OTP_TEMPLATE_ID', { infer: true });
    this.whatsappNumber = config.get('MSG91_WHATSAPP_NUMBER', { infer: true });

    /**
     * Local-development seam: with placeholder MSG91 credentials no SMS can
     * ever arrive, so every guarded route is unreachable because nobody can
     * complete a login. Printing the code to the server console keeps the
     * authenticated half of the app testable before Phase 3 wires real keys.
     *
     * Safe by construction rather than by discipline: `validateEnv` already
     * refuses to boot production when `MSG91_AUTH_KEY` or
     * `MSG91_OTP_TEMPLATE_ID` look like placeholders, so the condition below
     * cannot be true in a production process. The explicit NODE_ENV check is
     * belt-and-braces — it keeps this branch dead in production even if that
     * secrets list is ever narrowed.
     */
    const nodeEnv = config.get('NODE_ENV', { infer: true });
    this.logOtpInsteadOfSending =
      nodeEnv !== 'production' &&
      (looksLikePlaceholder(this.authKey) || looksLikePlaceholder(this.otpTemplateId));

    if (this.logOtpInsteadOfSending) {
      this.logger.warn(
        'MSG91 credentials are placeholders — OTPs will be printed to this console instead of sent by SMS. Never expected outside local development.',
      );
    }
  }

  /**
   * Sends an OTP. When `otp` is supplied MSG91 delivers that exact value,
   * which is what lets us keep the hash we compare against rather than asking
   * MSG91 to remember it for us.
   *
   * NOTE: the MSG91 v5 OTP paths below are unverified against a live account —
   * they must be confirmed during the Phase 3 credential smoke test before any
   * real traffic depends on them.
   */
  async sendOtp(phone: string, otp?: string): Promise<void> {
    if (this.logOtpInsteadOfSending) {
      this.logDevOtp(phone, otp);
      return;
    }

    const url = new URL(`${MSG91_BASE_URL}/otp`);
    url.searchParams.set('template_id', this.otpTemplateId);
    url.searchParams.set('mobile', phone);
    if (otp) {
      url.searchParams.set('otp', otp);
    }

    const response = await this.request(url.toString(), { method: 'POST' }, 'sendOtp');
    const body = await this.readJson(response, 'sendOtp');

    // MSG91 returns HTTP 200 with `type: "error"` for application-level
    // failures (unapproved template, blocked number), so a 2xx alone is not
    // success — this branch is the difference between "OTP sent" and silence.
    if (body.type === 'error') {
      this.logger.error(`MSG91 sendOtp rejected: ${body.message}`);
      throw new SmsProviderError(
        `MSG91 rejected the OTP request: ${body.message ?? 'unknown reason'}`,
        response.status,
        body,
      );
    }

    /**
     * A success here is **not** proof of delivery.
     *
     * Verified against the live API: MSG91 returns HTTP 200 `{"type":"success"}`
     * even for a completely invalid auth key and template id. Nothing this
     * provider can inspect distinguishes a real send from a misconfigured one,
     * so the guard against that lives in env validation, which refuses to start
     * production with placeholder credentials.
     *
     * What we can do is record MSG91's `request_id`. It is the only handle that
     * ties a "my OTP never arrived" support report to a specific send in their
     * dashboard — without it such a report is unanswerable.
     */
    this.logger.log(
      `MSG91 accepted OTP for ${this.maskPhone(phone)} (request_id: ${body.request_id ?? 'not returned'})`,
    );
  }

  /**
   * Verifies an OTP.
   *
   * Returns `false` for a wrong or expired code and throws only when MSG91
   * itself failed. That distinction is the whole contract: a wrong code is the
   * user's problem (401 to the client), an outage is ours (503). Collapsing
   * them — as an earlier version did by throwing on MSG91's HTTP 400 "invalid
   * OTP" response — would have made every mistyped digit look like an incident,
   * and would have let a retry storm hide a real outage.
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const url = new URL(`${MSG91_BASE_URL}/otp/verify`);
    url.searchParams.set('mobile', phone);
    url.searchParams.set('otp', otp);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url.toString(),
        { method: 'GET', headers: { authkey: this.authKey } },
        SMS_TIMEOUT_MS,
      );
    } catch (error) {
      throw this.toProviderError(error, 'verifyOtp');
    }

    const body = await this.readJson(response, 'verifyOtp');

    if (response.ok) {
      return body.type === 'success';
    }

    // MSG91 answers a bad or expired code with 4xx + `type: "error"`. That is a
    // normal outcome of the verify flow, not an upstream fault.
    if (response.status >= 400 && response.status < 500) {
      this.logger.warn(
        `MSG91 rejected OTP for ${this.maskPhone(phone)}: ${body.message ?? 'invalid code'}`,
      );
      return false;
    }

    this.logger.error(`MSG91 verifyOtp failed [${response.status}]: ${body.message}`);
    throw new SmsProviderError(
      `MSG91 failed to verify OTP: HTTP ${response.status}`,
      response.status,
      body,
    );
  }

  /**
   * Sends a templated WhatsApp notification (order confirmation, dispatch).
   *
   * `integrated_number` is the WhatsApp business phone number — deliberately a
   * separate config value from `MSG91_SENDER_ID`, which is the 6-character DLT
   * SMS sender header. They are different identifiers on different channels;
   * an earlier version passed the sender ID here, which would have failed
   * against a live account.
   */
  async whatsappNotify(
    phone: string,
    templateName: string,
    bodyParams: Record<string, string>,
  ): Promise<void> {
    const url = `${MSG91_BASE_URL}/whatsapp/whatsapp-outbound-message/bulk/`;

    const components: Record<string, { type: string; value: string }> = {};
    Object.entries(bodyParams).forEach(([key, value], index) => {
      components[key || `body_${index + 1}`] = { type: 'text', value };
    });

    const payload = {
      integrated_number: this.whatsappNumber,
      content_type: 'template',
      payload: {
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en', policy: 'deterministic' },
          to_and_components: [{ to: [phone], components }],
        },
      },
    };

    await this.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'whatsappNotify',
    );
  }

  /** Issues a request and throws `SmsProviderError` on any non-2xx or transport failure. */
  private async request(url: string, init: RequestInit, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          ...init,
          headers: { authkey: this.authKey, ...(init.headers ?? {}) },
        },
        SMS_TIMEOUT_MS,
      );
    } catch (error) {
      throw this.toProviderError(error, operation);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '<unreadable body>');
      this.logger.error(`MSG91 ${operation} failed [${response.status}]: ${errText}`);
      throw new SmsProviderError(
        `MSG91 ${operation} failed: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    return response;
  }

  /**
   * MSG91 occasionally answers with a non-JSON body (HTML error pages from
   * their edge). Treat that as an empty payload rather than letting a parse
   * error masquerade as a network fault.
   */
  private async readJson(response: Response, operation: string): Promise<Msg91Response> {
    try {
      return (await response.json()) as Msg91Response;
    } catch {
      this.logger.warn(`MSG91 ${operation} returned a non-JSON body`);
      return {};
    }
  }

  private toProviderError(error: unknown, operation: string): SmsProviderError {
    if (error instanceof UpstreamTimeoutError) {
      this.logger.error(`MSG91 ${operation} timed out after ${error.timeoutMs}ms`);
      return new SmsProviderError(`MSG91 ${operation} timed out`, undefined, error);
    }

    this.logger.error(`MSG91 ${operation} was unreachable`, error);
    return new SmsProviderError(`MSG91 ${operation} was unreachable`, undefined, error);
  }

  /**
   * Prints the login code to the server console in place of an SMS.
   *
   * The phone stays masked as everywhere else, but the code itself is printed
   * in full — a masked code would defeat the entire purpose. This runs only on
   * the placeholder-credential path guarded in the constructor.
   */
  private logDevOtp(phone: string, otp?: string): void {
    if (!otp) {
      // Both current callers generate the code themselves and pass it here. A
      // caller that instead relies on MSG91 to invent one has nothing to print,
      // and the resulting code would be unverifiable anyway.
      this.logger.error(
        `Cannot print an OTP for ${this.maskPhone(phone)}: no code was supplied, and MSG91 is not being called to generate one. This login cannot be completed with placeholder credentials.`,
      );
      return;
    }

    this.logger.warn(
      `[DEV OTP] ${this.maskPhone(phone)} -> ${otp}  (no SMS sent; placeholder MSG91 credentials)`,
    );
  }

  /** Phone numbers are personal data; logs get the last four digits only. */
  private maskPhone(phone: string): string {
    return phone.length <= 4 ? '****' : `****${phone.slice(-4)}`;
  }
}
