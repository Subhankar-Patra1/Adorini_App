import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AddressesController } from './controllers/addresses.controller';
import { UsersController } from './controllers/users.controller';
import { AddressesService } from './services/addresses.service';
import { UsersService } from './services/users.service';
import { Address, Referral, User } from '../../database/entities';
import { StorageModule } from '../../providers/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Address, Referral]), StorageModule],
  controllers: [UsersController, AddressesController],
  providers: [UsersService, AddressesService],
  exports: [UsersService, AddressesService],
})
export class UsersModule {}
