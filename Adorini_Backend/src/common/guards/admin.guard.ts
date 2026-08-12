import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../database/entities/user.entity';
import type { AuthenticatedRequest } from '../types/auth-user';

/**
 * Restricts a route to staff.
 *
 * Runs after `JwtAuthGuard`, which has already established *who* is calling;
 * this decides whether they may. Applied per controller rather than globally —
 * admin is the exception, not the default.
 *
 * It reads `is_admin` from the database on every request rather than trusting a
 * claim in the token. Access tokens live 15 minutes and carry only `sub`
 * (ADR-013), so an `isAdmin` claim would keep working for a quarter of an hour
 * after someone's access was revoked. For the endpoints that can reprice the
 * catalogue and edit orders, that window is not acceptable — and admin traffic
 * is low enough that the extra read costs nothing that matters.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      // Only reachable if this guard is used without JwtAuthGuard in front,
      // which is a wiring mistake rather than a caller's fault.
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.users.findOne({
      where: { id: request.user.id },
      select: { id: true, isAdmin: true },
    });

    if (!user?.isAdmin) {
      // Deliberately identical whether the account is missing or merely not
      // staff — neither tells a prober anything about the other.
      throw new ForbiddenException('Administrator access required');
    }

    return true;
  }
}
