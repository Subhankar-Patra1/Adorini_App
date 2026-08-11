import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

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

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly authKey: string;
  private readonly otpTemplateId: string;
  private readonly senderId: string;

  constructor(config: ConfigService<Env, true>) {
    this.authKey = config.get('MSG91_AUTH_KEY', { infer: true });
    this.otpTemplateId = config.get('MSG91_OTP_TEMPLATE_ID', { infer: true });
    this.senderId = config.get('MSG91_SENDER_ID', { infer: true });
  }

  /**
   * Sends an OTP via MSG91 REST v5 API.
   * If `otp` is passed, MSG91 sends that explicit OTP value.
   */
  async sendOtp(phone: string, otp?: string): Promise<void> {
    const url = new URL('https://control.msg91.com/api/v5/otp/request');
    url.searchParams.set('template_id', this.otpTemplateId);
    url.searchParams.set('mobile', phone);
    if (otp) {
      url.searchParams.set('otp', otp);
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        authkey: this.authKey,
        'content-type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`MSG91 sendOtp failed [${response.status}]: ${errText}`);
      throw new SmsProviderError(
        `Failed to send OTP via MSG91: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    const resJson = (await response.json()) as { type?: string; message?: string };
    if (resJson.type === 'error') {
      this.logger.error(`MSG91 API error response: ${resJson.message}`);
      throw new SmsProviderError(`MSG91 API Error: ${resJson.message}`, 400, resJson);
    }
  }

  /**
   * Verifies an OTP via MSG91 REST v5 API.
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const url = new URL('https://control.msg91.com/api/v5/otp/verify');
    url.searchParams.set('mobile', phone);
    url.searchParams.set('otp', otp);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authkey: this.authKey,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`MSG91 verifyOtp failed [${response.status}]: ${errText}`);
      throw new SmsProviderError(
        `Failed to verify OTP via MSG91: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    const resJson = (await response.json()) as { type?: string; message?: string };
    return resJson.type === 'success';
  }

  /**
   * Sends a WhatsApp outbound notification via MSG91.
   * Uses a generic template schema mapping until specific template schemas are finalized.
   */
  async whatsappNotify(
    phone: string,
    templateName: string,
    bodyParams: Record<string, string>,
  ): Promise<void> {
    const url = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

    const components: Record<string, { type: string; value: string }> = {};
    Object.entries(bodyParams).forEach(([key, val], idx) => {
      components[key || `body_${idx + 1}`] = {
        type: 'text',
        value: val,
      };
    });

    const payload = {
      integrated_number: this.senderId,
      content_type: 'template',
      payload: {
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en', policy: 'deterministic' },
          to_and_components: [
            {
              to: [phone],
              components,
            },
          ],
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authkey: this.authKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`MSG91 whatsappNotify failed [${response.status}]: ${errText}`);
      throw new SmsProviderError(
        `Failed to send WhatsApp notification via MSG91: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }
  }
}
