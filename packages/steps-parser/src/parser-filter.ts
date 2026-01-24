/**
 * Parser Filter
 *
 * First filter in the validation pipeline.
 * Detects invoice format and parses XML to CanonicalInvoice.
 *
 * Responsibilities:
 * - Format detection (XRechnung, ZUGFeRD, Peppol-BIS, UBL, CII)
 * - XML parsing to CanonicalInvoice (EN16931 minimal subset)
 * - Setting context.parsedInvoice and context.detectedFormat
 *
 * NOT responsible for:
 * - Amount consistency validation (semantic filter)
 * - Schema/Schematron validation (KoSIT filter)
 * - External API verification (live filters)
 *
 * Privacy:
 * - No PII is logged
 * - No raw XML is returned in results
 * - Only format/profile/documentType metadata in report
 */

import type { Filter, FilterContext, StepResult, Diagnostic, ParsedInvoice, InvoiceFormat } from '@fiscal-layer/contracts';
import { detectInvoiceFormatFromXml } from './detect-format.js';
import { parseXmlToCanonicalInvoice } from './parse-xml.js';
import type { ParserFilterConfig, ParserResult } from './types.js';

/**
 * Default configuration for Parser Filter
 */
const DEFAULT_CONFIG: Required<ParserFilterConfig> = {
  failOnUnknownFormat: false,
  failOnParseError: true,
  maxXmlSize: 10 * 1024 * 1024, // 10MB
};

/**
 * Parser Filter Factory
 *
 * Creates a parser filter instance with optional configuration.
 *
 * @example
 * ```typescript
 * const parser = createParserFilter({ failOnUnknownFormat: true });
 * registry.register(parser);
 * ```
 */
export function createParserFilter(userConfig?: ParserFilterConfig): Filter {
  const config: Required<ParserFilterConfig> = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  const filter: Filter = {
    id: 'steps-parser',
    name: 'Invoice Parser',
    version: '0.0.1',
    description: 'Detects invoice format and parses XML to CanonicalInvoice (EN16931)',
    tags: ['core', 'parser', 'oss'],

    async execute(context: FilterContext): Promise<StepResult> {
      const startTime = Date.now();
      const startedAt = new Date().toISOString();
      const diagnostics: Diagnostic[] = [];

      try {
        // Get XML content from context
        const xml = context.rawInvoice.content;

        // Size check (no PII in error message)
        if (xml.length > config.maxXmlSize) {
          return createFailedResult(
            filter.id,
            startTime,
            startedAt,
            [{
              code: 'PARSE-SIZE',
              message: `Invoice exceeds maximum size (${Math.round(config.maxXmlSize / 1024 / 1024)}MB)`,
              severity: 'error',
              category: 'format',
              source: filter.id,
            }]
          );
        }

        // Step 1: Detect format
        const formatResult = detectInvoiceFormatFromXml(xml);

        // Add any detection warnings
        diagnostics.push(...formatResult.warnings);

        // Check for unknown format
        if (formatResult.format === 'unknown') {
          if (config.failOnUnknownFormat) {
            return createFailedResult(
              filter.id,
              startTime,
              startedAt,
              [{
                code: 'PARSE-FORMAT',
                message: 'Unable to detect invoice format',
                severity: 'error',
                category: 'format',
                source: filter.id,
              }, ...diagnostics]
            );
          }

          // Return warning but continue
          diagnostics.push({
            code: 'PARSE-FORMAT-WARN',
            message: 'Invoice format could not be determined - defaulting to UBL',
            severity: 'warning',
            category: 'format',
            source: filter.id,
          });
        }

        // Step 2: Parse to CanonicalInvoice
        let canonicalInvoice;
        try {
          canonicalInvoice = parseXmlToCanonicalInvoice(xml, formatResult);
        } catch (parseError) {
          const err = parseError as Error;

          if (config.failOnParseError) {
            return createFailedResult(
              filter.id,
              startTime,
              startedAt,
              [{
                code: 'PARSE-XML',
                message: `Failed to parse invoice XML: ${sanitizeErrorMessage(err.message)}`,
                severity: 'error',
                category: 'format',
                source: filter.id,
              }, ...diagnostics]
            );
          }

          // Continue with minimal parsed data
          diagnostics.push({
            code: 'PARSE-XML-WARN',
            message: `Partial parse: ${sanitizeErrorMessage(err.message)}`,
            severity: 'warning',
            category: 'format',
            source: filter.id,
          });

          // Create minimal fallback
          canonicalInvoice = {
            originalFormat: formatResult.format,
            invoiceTypeCode: '380' as const,
            invoiceNumber: 'UNKNOWN',
            issueDate: new Date().toISOString().split('T')[0] as string,
            currencyCode: 'EUR',
            seller: { name: 'Unknown' },
            buyer: { name: 'Unknown' },
            lineItems: [],
            totals: {
              lineExtensionAmount: '0',
              taxExclusiveAmount: '0',
              taxAmount: '0',
              taxBreakdown: [],
              taxInclusiveAmount: '0',
              payableAmount: '0',
            },
          };
        }

        // Step 3: Convert CanonicalInvoice to ParsedInvoice for context
        const parsedInvoice = convertToParsedInvoice(canonicalInvoice, formatResult);

        // Determine final status
        const hasErrors = diagnostics.some(d => d.severity === 'error');
        const hasWarnings = diagnostics.some(d => d.severity === 'warning');
        const status = hasErrors ? 'failed' : hasWarnings ? 'warning' : 'passed';

        return {
          filterId: filter.id,
          filterVersion: filter.version,
          status,
          diagnostics,
          durationMs: Date.now() - startTime,
          startedAt,
          completedAt: new Date().toISOString(),
          metadata: {
            // Safe metadata - no PII, no raw XML
            parsedInvoice,
            canonicalInvoice,
            detectedFormat: formatResult.format,
            documentType: formatResult.documentType,
            profile: formatResult.profile,
            customizationId: formatResult.customizationId,
            schemaVersion: formatResult.schemaVersion,
          },
        };
      } catch (error) {
        const err = error as Error;

        return createFailedResult(
          filter.id,
          startTime,
          startedAt,
          [{
            code: 'PARSE-INTERNAL',
            message: `Internal parser error: ${sanitizeErrorMessage(err.message)}`,
            severity: 'error',
            category: 'internal',
            source: filter.id,
          }]
        );
      }
    },
  };

  return filter;
}

/**
 * Pre-configured parser filter with default settings
 */
export const parserFilter = createParserFilter();

/**
 * Create a failed step result
 */
function createFailedResult(
  filterId: string,
  startTime: number,
  startedAt: string,
  diagnostics: Diagnostic[]
): StepResult {
  return {
    filterId,
    status: 'failed',
    diagnostics,
    durationMs: Date.now() - startTime,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Sanitize error message to remove potential PII/paths
 */
function sanitizeErrorMessage(message: string): string {
  // Remove file paths
  let sanitized = message.replace(/\/[^\s]+/g, '[path]');

  // Remove potential XML content snippets
  sanitized = sanitized.replace(/<[^>]+>/g, '[xml]');

  // Truncate long messages
  if (sanitized.length > 200) {
    sanitized = sanitized.slice(0, 200) + '...';
  }

  return sanitized;
}

/**
 * Convert CanonicalInvoice to ParsedInvoice (legacy format for context)
 */
function convertToParsedInvoice(
  canonical: ReturnType<typeof parseXmlToCanonicalInvoice>,
  formatResult: ParserResult
): ParsedInvoice {
  // Calculate totals
  const totalAmount = parseFloat(canonical.totals.taxInclusiveAmount) || 0;
  const taxAmount = parseFloat(canonical.totals.taxAmount) || 0;

  // Build seller info with conditional properties (exactOptionalPropertyTypes)
  const sellerInfo: ParsedInvoice['seller'] = { name: canonical.seller.name };
  if (canonical.seller.vatId) sellerInfo.vatId = canonical.seller.vatId;
  if (canonical.seller.postalAddress?.streetName) sellerInfo.street = canonical.seller.postalAddress.streetName;
  if (canonical.seller.postalAddress?.cityName) sellerInfo.city = canonical.seller.postalAddress.cityName;
  if (canonical.seller.postalAddress?.postalZone) sellerInfo.postalCode = canonical.seller.postalAddress.postalZone;
  if (canonical.seller.postalAddress?.countryCode) sellerInfo.country = canonical.seller.postalAddress.countryCode;

  // Build buyer info with conditional properties
  const buyerInfo: ParsedInvoice['buyer'] = { name: canonical.buyer.name };
  if (canonical.buyer.vatId) buyerInfo.vatId = canonical.buyer.vatId;
  if (canonical.buyer.postalAddress?.streetName) buyerInfo.street = canonical.buyer.postalAddress.streetName;
  if (canonical.buyer.postalAddress?.cityName) buyerInfo.city = canonical.buyer.postalAddress.cityName;
  if (canonical.buyer.postalAddress?.postalZone) buyerInfo.postalCode = canonical.buyer.postalAddress.postalZone;
  if (canonical.buyer.postalAddress?.countryCode) buyerInfo.country = canonical.buyer.postalAddress.countryCode;

  const result: ParsedInvoice = {
    format: formatResult.format as InvoiceFormat,
    invoiceNumber: canonical.invoiceNumber,
    issueDate: canonical.issueDate,
    currency: canonical.currencyCode,
    totalAmount,
    taxAmount,
    seller: sellerInfo,
    buyer: buyerInfo,
    lineItems: canonical.lineItems.map((line, index) => ({
      lineNumber: index + 1,
      description: line.description,
      quantity: parseFloat(line.quantity) || 0,
      unit: line.unitCode,
      unitPrice: parseFloat(line.unitPrice) || 0,
      lineTotal: parseFloat(line.lineNetAmount) || 0,
      taxRate: parseFloat(line.taxCategory.rate) || 0,
    })),
  };

  // Add optional fields
  if (canonical.dueDate) result.dueDate = canonical.dueDate;

  // Build extensions with conditional properties
  const extensions: Record<string, unknown> = {};
  if (formatResult.documentType) extensions['documentType'] = formatResult.documentType;
  if (formatResult.profile) extensions['profile'] = formatResult.profile;
  if (formatResult.customizationId) extensions['customizationId'] = formatResult.customizationId;
  if (formatResult.schemaVersion) extensions['schemaVersion'] = formatResult.schemaVersion;
  if (Object.keys(extensions).length > 0) result.extensions = extensions;

  return result;
}
