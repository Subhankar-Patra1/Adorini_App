import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness probe. Deliberately dependency-free — Railway uses this to decide
   * whether the process is up, so it must not fail when Postgres or Redis is
   * degraded. Killing a healthy process because the database blipped turns a
   * recoverable incident into an outage.
   */
  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness probe' })
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness probe. This one *does* check dependencies: it decides whether the
   * instance should receive traffic, and an instance that cannot reach Postgres
   * can serve nothing useful. Kept separate from liveness precisely so a
   * database outage drains traffic without restart-looping the app.
   */
  @Get('ready')
  @SkipThrottle()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — verifies database connectivity' })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.pingCheck('database', { timeout: 3000 })]);
  }
}
