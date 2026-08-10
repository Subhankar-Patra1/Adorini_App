import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@Controller('health')
export class HealthController {
  /**
   * Liveness probe. Deliberately dependency-free — Railway uses this to decide
   * whether the process is up, so it must not fail when Postgres or Redis is
   * degraded. Readiness (dependency checks) is added in Phase 2 once a
   * datasource exists.
   */
  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness probe' })
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
