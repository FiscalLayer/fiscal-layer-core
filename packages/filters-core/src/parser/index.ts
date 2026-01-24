/**
 * Parser filter for invoice format detection and parsing.
 *
 * This module re-exports the parser from @fiscal-layer/steps-parser
 * for backward compatibility with existing code that imports from
 * @fiscal-layer/filters-core.
 *
 * @example
 * ```typescript
 * // Both imports work:
 * import { parserFilter } from '@fiscal-layer/filters-core';
 * import { parserFilter } from '@fiscal-layer/steps-parser';
 * ```
 */

// Re-export everything from steps-parser
export {
  parserFilter,
  createParserFilter,
  detectInvoiceFormatFromXml,
  parseXmlToCanonicalInvoice,
  PARSER_FILTER_ID,
  XML_NAMESPACES,
  FORMAT_PROFILES,
} from '@fiscal-layer/steps-parser';

// Re-export types
export type {
  DetectedFormat,
  DocumentType,
  ParserResult,
  ParserFilterConfig,
  ParsedXml,
} from '@fiscal-layer/steps-parser';
