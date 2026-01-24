/**
 * @fiscal-layer/steps-parser
 *
 * XML Invoice Parser for FiscalLayer (OSS).
 *
 * This package provides:
 * - Invoice format detection (XRechnung, ZUGFeRD, Peppol-BIS, UBL, CII)
 * - XML parsing to CanonicalInvoice (EN16931 minimal subset)
 * - ParserFilter for pipeline integration
 *
 * Zero external API calls - safe for offline/air-gapped environments.
 *
 * @packageDocumentation
 */

// Main filter
export { parserFilter, createParserFilter } from './parser-filter.js';

// Detection function (for direct use)
export { detectInvoiceFormatFromXml } from './detect-format.js';

// Parsing function (for direct use)
export { parseXmlToCanonicalInvoice } from './parse-xml.js';

// Types
export type {
  DetectedFormat,
  DocumentType,
  ParserResult,
  ParserFilterConfig,
  ParsedXml,
} from './types.js';

// Constants (for testing and extension)
export { XML_NAMESPACES, FORMAT_PROFILES } from './types.js';

// Filter ID constant
export const PARSER_FILTER_ID = 'steps-parser';
