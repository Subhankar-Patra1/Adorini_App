import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { UsersController } from './users.controller';
import { UsersService } from '../services/users.service';

/**
 * Scoped to the avatar route only — `UsersController`'s other routes have no
 * existing controller spec, and adding coverage for code this change did not
 * touch is out of scope here.
 */
describe('UsersController — uploadAvatar', () => {
  let controller: UsersController;
  let users: { updateAvatar: jest.Mock };

  beforeEach(async () => {
    users = { updateAvatar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: users }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('passes the caller id and file through to the service', async () => {
    const file = { mimetype: 'image/jpeg', buffer: Buffer.from('x') } as Express.Multer.File;
    users.updateAvatar.mockResolvedValue({});

    await controller.uploadAvatar({ id: 'user-1' }, file);

    expect(users.updateAvatar).toHaveBeenCalledWith('user-1', file);
  });

  it('rejects when multer supplies no file', () => {
    expect(() => controller.uploadAvatar({ id: 'user-1' }, undefined)).toThrow(
      BadRequestException,
    );
    expect(users.updateAvatar).not.toHaveBeenCalled();
  });
});
