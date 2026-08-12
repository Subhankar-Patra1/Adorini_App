import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Marks a response as never cacheable.
 *
 * ADR-003 puts Cloudflare in front of the Railway origin, and a cached
 * cart, checkout or order response is one buyer's basket, total, or delivery
 * address served to a different person. The risk is asymmetric: caching a
 * personal response is a data leak, while failing to cache one costs a little
 * bandwidth — so these routes opt out explicitly rather than relying on the
 * edge to infer it.
 *
 * An interceptor rather than `@Header()` on every method: `@Header()` is a
 * method decorator, so a class-wide guarantee would mean repeating it on each
 * route and remembering it on every route added later. Applied once at the
 * controller, this cannot be forgotten per-endpoint.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    // `private` covers intermediaries that ignore no-store; the pair is what
    // real-world proxies actually honour.
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');

    return next.handle();
  }
}
