import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

export class LogisticsProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'LogisticsProviderError';
  }
}

export interface DelhiveryShipmentPayload {
  shipments: Array<{
    name: string;
    add: string;
    pin: string;
    city: string;
    state: string;
    phone: string;
    order: string;
    payment_mode: 'Pre-paid' | 'COD';
    weight?: number;
    height?: number;
    width?: number;
    length?: number;
    product_type?: string;
    [key: string]: unknown;
  }>;
  pickup_location: {
    name: string;
    add?: string;
    pin?: string;
    city?: string;
    state?: string;
    country?: string;
    phone?: string;
    [key: string]: unknown;
  };
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.apiToken = config.get('DELHIVERY_API_TOKEN', { infer: true });
    const rawBaseUrl = config.get('DELHIVERY_BASE_URL', { infer: true });
    this.baseUrl = rawBaseUrl.replace(/\/$/, '');
  }

  /**
   * Registers a shipment with Delhivery using their form-encoded format (`format=json&data={...}`).
   */
  async createShipment(payload: DelhiveryShipmentPayload): Promise<any> {
    const url = `${this.baseUrl}/api/cmu/create.json`;

    const bodyString = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyString,
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Delhivery createShipment failed [${response.status}]: ${errText}`);
      throw new LogisticsProviderError(
        `Failed to create shipment via Delhivery: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    const resJson = await response.json();
    return resJson;
  }

  /**
   * Fetches package tracking details by waybill number.
   */
  async fetchTracking(waybill: string): Promise<any> {
    const url = `${this.baseUrl}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Token ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Delhivery fetchTracking failed [${response.status}]: ${errText}`);
      throw new LogisticsProviderError(
        `Failed to fetch tracking via Delhivery: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    const resJson = await response.json();
    return resJson;
  }
}
