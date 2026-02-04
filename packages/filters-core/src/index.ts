/**
 * @fiscal-layer/filters-core
 *
 * Core validation filters for FiscalLayer (OSS).
 *
 * This package contains offline validation filters that do NOT make
 * external API calls. Safe to audit and use in air-gapped environments.
 *
 * For live verification filters (VIES, ECB, Peppol), see @fiscal-layer/filters-live.
 *
 * @packageDocumentation
 */

// Parser
export { parserFilter } from './parser/index.js';

// KoSIT Validator (offline - uses local Docker/Java)
export { kositFilter } from './kosit/index.js';

// Semantic Risk (offline analysis)
export { semanticRiskFilter } from './semantic-risk/index.js';

// Re-export filter IDs for convenience
export const CORE_FILTER_IDS = {
  PARSER: 'parser',
  KOSIT: 'kosit',
  SEMANTIC_RISK: 'semantic-risk',
} as const;

/**
 * All core filters in recommended execution order
 */
export const CORE_FILTERS = ['parser', 'kosit', 'semantic-risk'] as const;
