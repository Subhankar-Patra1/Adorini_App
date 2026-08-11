import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

/**
 * Converts an identifier to snake_case.
 *
 * Handles the two boundaries that matter for our entity names:
 *   `sizeRules`      -> `size_rules`      (lower/digit followed by upper)
 *   `productSKUCode` -> `product_sku_code` (acronym followed by a word)
 */
function snake(input: string): string {
  return input
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Postgres folds unquoted identifiers to lowercase, so TypeORM's default
 * camelCase column names must be double-quoted in every hand-written query.
 * The @GUARD mitigations are specified against snake_case identifiers
 * (`processed_webhooks`, `webhook_event_id`, `category_id`, `referrer_id`), and
 * Phase 2 raw-SQL migrations plus the QueryBuilder escape hatches ADR-001
 * relies on are far easier to read and review without quoting noise.
 *
 * Applying this globally is the alternative to hand-writing `name:` on every
 * column — one rule, no drift.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? snake(className);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const name = customName ?? propertyName;
    return snake(embeddedPrefixes.concat(name).join('_'));
  }

  override relationName(propertyName: string): string {
    return snake(propertyName);
  }

  /** `category` + `id` -> `category_id` — the shape @GUARD Risk #4 indexes. */
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  override joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
  ): string {
    return snake(`${firstTableName}_${firstPropertyName.replace(/\./gi, '_')}_${secondTableName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snake(`${tableName}_${columnName ?? propertyName}`);
  }
}
