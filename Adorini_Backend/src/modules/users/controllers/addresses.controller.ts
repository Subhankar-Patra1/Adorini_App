import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AddressResponseDto, CreateAddressDto, UpdateAddressDto } from '../dto/users.dto';
import { AddressesService } from '../services/addresses.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Address } from '../../../database/entities';
import type { AuthUser } from '../../../common/types/auth-user';

/**
 * Saved delivery addresses.
 *
 * Every route is scoped to the signed-in user, and an address belonging to
 * someone else returns 404 rather than 403 — a 403 confirms the id exists.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List saved addresses, default first' })
  @ApiResponse({ status: 200, type: [AddressResponseDto] })
  list(@CurrentUser() user: AuthUser): Promise<Address[]> {
    return this.addresses.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one saved address' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'No such address for this user' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Address> {
    return this.addresses.get(user.id, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Save a new address',
    description: 'The first address saved by a user automatically becomes their default.',
  })
  @ApiResponse({ status: 201, type: AddressResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto): Promise<Address> {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a saved address' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'No such address for this user' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<Address> {
    return this.addresses.update(user.id, id, dto);
  }

  @Post(':id/default')
  // Nest defaults POST to 201, but nothing is created here — this promotes an
  // existing row and returns it.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make this the default delivery address' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'No such address for this user' })
  setDefault(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Address> {
    return this.addresses.setDefault(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved address',
    description: 'Deleting the default promotes the most recently added remaining address.',
  })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'No such address for this user' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
