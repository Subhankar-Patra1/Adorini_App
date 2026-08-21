import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';

import { WhatsappBotController } from './whatsapp-bot.controller';
import type { Env } from '../../../config/env.validation';
import { WhatsappBotService } from '../services/whatsapp-bot.service';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'v'.repeat(24);

describe('WhatsappBotController', () => {
  let controller: WhatsappBotController;
  let bot: { handleInbound: jest.Mock };

  const mockResponse = () => {
    const res: { status: jest.Mock; send: jest.Mock } = {
      status: jest.fn(),
      send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  const rawRequest = (body: unknown, signature?: string) => {
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const sig = signature ?? sign(rawBody);
    return {
      rawBody,
      headers: { 'x-hub-signature-256': sig },
    } as never;
  };

  function sign(rawBody: Buffer): string {
    return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
  }

  function withMessage(message: Record<string, unknown>) {
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { messages: [message] } }] }],
    };
  }

  beforeEach(async () => {
    bot = { handleInbound: jest.fn().mockResolvedValue('reattempt_requested') };

    const config: Partial<ConfigService<Env, true>> = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' ? VERIFY_TOKEN : APP_SECRET,
      ) as never,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappBotController],
      providers: [
        { provide: WhatsappBotService, useValue: bot },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get(WhatsappBotController);
  });

  describe('verify (GET handshake)', () => {
    it('echoes the challenge back as plain text when the mode and token match', () => {
      const res = mockResponse();

      controller.verify('subscribe', VERIFY_TOKEN, 'challenge-123', res as never);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('challenge-123');
    });

    it('rejects a wrong verify token', () => {
      const res = mockResponse();

      controller.verify('subscribe', 'wrong-token', 'challenge-123', res as never);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects a mode other than subscribe', () => {
      const res = mockResponse();

      controller.verify('unsubscribe', VERIFY_TOKEN, 'challenge-123', res as never);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('inbound (POST)', () => {
    it('verifies the signature against the exact raw bytes received', async () => {
      const body = withMessage({ id: 'wamid.1', from: '919876543210', text: { body: 'yes' } });

      await controller.inbound(rawRequest(body));

      expect(bot.handleInbound).toHaveBeenCalledWith({
        messageId: 'wamid.1',
        fromPhone: '919876543210',
        text: 'yes',
      });
    });

    it('rejects an invalid signature before parsing the payload', async () => {
      const body = withMessage({ id: 'wamid.1', from: '919876543210', text: { body: 'yes' } });

      await expect(controller.inbound(rawRequest(body, 'sha256=deadbeef'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bot.handleInbound).not.toHaveBeenCalled();
    });

    it('rejects a missing signature header', async () => {
      const body = withMessage({ id: 'wamid.1', from: '919876543210', text: { body: 'yes' } });
      const request = {
        rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
        headers: {},
      } as never;

      await expect(controller.inbound(request)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a request with no body', async () => {
      await expect(controller.inbound({ headers: {} } as never)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers 2xx-and-ignored for a statuses[]-only payload, not an error', async () => {
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [{ field: 'messages', value: { statuses: [{ id: 's1' }] } }],
          },
        ],
      };

      const result = await controller.inbound(rawRequest(body));

      expect(result).toEqual({ outcome: 'ignored' });
      expect(bot.handleInbound).not.toHaveBeenCalled();
    });
  });
});
