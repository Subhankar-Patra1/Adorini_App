import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';
import { UpstreamTimeoutError, fetchWithTimeout } from '../../common/http/fetch-with-timeout';

/**
 * Delhivery is called from background jobs and webhook handlers rather than
 * from a request a buyer is waiting on, so it gets the full default budget.
 */
const LOGISTICS_TIMEOUT_MS = 15_000;

/** Delhivery rejected the request, was unreachable, or timed out. */
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

/**
 * Delhivery's shipment-creation response.
 *
 * `success: false` arrives with **HTTP 200** — the per-package `packages[]`
 * entries carry the real outcome. Treating 200 as success would record a
 * waybill that was never created.
 */
export interface DelhiveryCreateShipmentResponse {
  success?: boolean;
  packages?: Array<{
    waybill?: string;
    refnum?: string;
    status?: string;
    remarks?: string[];
    [key: string]: unknown;
  }>;
  rmk?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface DelhiveryTrackingResponse {
  ShipmentData?: Array<{
    Shipment?: {
      AWB?: string;
      Status?: {
        Status?: string;
        StatusDateTime?: string;
        StatusLocation?: string;
        Instructions?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
  }>;
  [key: string]: unknown;
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.apiToken = config.get('DELHIVERY_API_TOKEN', { infer: true });
    this.baseUrl = config.get('DELHIVERY_BASE_URL', { infer: true }).replace(/\/$/, '');
  }

  /**
   * Registers a shipment. Delhivery's create endpoint takes form-encoded
   * `format=json&data={...}` rather than a JSON body.
   */
  async createShipment(
    payload: DelhiveryShipmentPayload,
  ): Promise<DelhiveryCreateShipmentResponse> {
    const url = `${this.baseUrl}/api/cmu/create.json`;
    const body = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;

    const response = await this.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      'createShipment',
    );

    const parsed = await this.readJson<DelhiveryCreateShipmentResponse>(response, 'createShipment');

    // Delhivery signals application-level rejection inside a 200 response.
    if (parsed.success === false) {
      const remarks =
        parsed.packages
          ?.flatMap((pkg) => pkg.remarks ?? [])
          .filter(Boolean)
          .join('; ') ?? parsed.rmk;

      this.logger.error(`Delhivery rejected shipment creation: ${remarks ?? 'no reason given'}`);
      throw new LogisticsProviderError(
        `Delhivery rejected the shipment: ${remarks ?? 'no reason given'}`,
        response.status,
        parsed,
      );
    }

    return parsed;
  }

  /**
   * Asks Delhivery to attempt delivery again on a parcel that came back
   * undelivered — their NDR (non-delivery report) action endpoint.
   *
   * The same parcel and the same waybill: this is a redelivery, not a new
   * shipment. Delhivery caps how many times it will reattempt before returning
   * the parcel to origin, which is why callers must check
   * `MAX_DELIVERY_ATTEMPTS` before asking rather than relying on this to refuse.
   *
   * ⚠️ Endpoint shape is written from Delhivery's published NDR API and has
   * **not** been exercised against a live account — the business account is
   * still pending. Confirm the path, payload key names, and the success shape
   * on the first real integration test.
   */
  async requestReattempt(waybill: string): Promise<void> {
    const url = `${this.baseUrl}/api/p/update`;

    await this.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [{ waybill, act: 'RE-ATTEMPT' }],
        }),
      },
      'requestReattempt',
    );

    this.logger.log(`Requested Delhivery reattempt for waybill ${waybill}`);
  }

  /** Fetches tracking detail for a waybill. */
  async fetchTracking(waybill: string): Promise<DelhiveryTrackingResponse> {
    const url = `${this.baseUrl}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;

    const response = await this.request(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      'fetchTracking',
    );

    return this.readJson<DelhiveryTrackingResponse>(response, 'fetchTracking');
  }

  private async request(url: string, init: RequestInit, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          ...init,
          headers: {
            Authorization: `Token ${this.apiToken}`,
            ...(init.headers ?? {}),
          },
        },
        LOGISTICS_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof UpstreamTimeoutError) {
        this.logger.error(`Delhivery ${operation} timed out after ${error.timeoutMs}ms`);
        throw new LogisticsProviderError(`Delhivery ${operation} timed out`, undefined, error);
      }
      this.logger.error(`Delhivery ${operation} was unreachable`, error);
      throw new LogisticsProviderError(`Delhivery ${operation} was unreachable`, undefined, error);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '<unreadable body>');
      this.logger.error(`Delhivery ${operation} failed [${response.status}]: ${errText}`);
      throw new LogisticsProviderError(
        `Delhivery ${operation} failed: HTTP ${response.status}`,
        response.status,
        errText,
      );
    }

    return response;
  }

  private async readJson<T>(response: Response, operation: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      this.logger.error(`Delhivery ${operation} returned a non-JSON body`, error);
      throw new LogisticsProviderError(
        `Delhivery ${operation} returned a non-JSON body`,
        response.status,
        error,
      );
    }
  }
}
