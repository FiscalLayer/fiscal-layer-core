import type { Filter, FilterContext, StepResult, ParsedInvoice, InvoiceFormat } from '@fiscal-layer/contracts';

/**
 * Parser filter - parses invoice documents and detects format.
 *
 * This is part of the OSS core - no external API calls.
 *
 * Production version would:
 * - Parse XML using a proper XML parser
 * - Detect format from namespace/structure
 * - Extract all invoice fields
 */
export const parserFilter: Filter = {
  id: 'parser',
  name: 'Invoice Parser',
  version: '0.0.1',
  description: 'Parses invoice documents and detects format',
  tags: ['core', 'parser'],

  async execute(context: FilterContext): Promise<StepResult> {
    const { rawInvoice } = context;
    const startTime = Date.now();

    try {
      // Detect format from content
      const format = detectFormat(rawInvoice.content, rawInvoice.formatHint);

      // Parse invoice (placeholder - returns mock data)
      const parsedInvoice = parseInvoice(rawInvoice.content, format);

      return {
        filterId: 'parser',
        status: 'passed',
        diagnostics: [],
        durationMs: Date.now() - startTime,
        metadata: {
          parsedInvoice,
          detectedFormat: format,
        },
      };
    } catch (error) {
      const err = error as Error;
      return {
        filterId: 'parser',
        status: 'failed',
        diagnostics: [
          {
            code: 'PARSE-001',
            message: `Failed to parse invoice: ${err.message}`,
            severity: 'error',
            category: 'format',
            source: 'parser',
          },
        ],
        durationMs: Date.now() - startTime,
      };
    }
  },
};

/**
 * Detect invoice format from content.
 */
function detectFormat(content: string, hint?: InvoiceFormat): InvoiceFormat {
  if (hint && hint !== 'unknown') {
    return hint;
  }

  // Simple detection based on content patterns
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('xrechnung') || lowerContent.includes('urn:cen.eu:en16931')) {
    return 'xrechnung';
  }

  if (lowerContent.includes('zugferd') || lowerContent.includes('factur-x')) {
    return 'zugferd';
  }

  if (lowerContent.includes('peppol') || lowerContent.includes('urn:oasis:names:specification:ubl')) {
    return 'peppol-bis';
  }

  if (lowerContent.includes('urn:un:unece:uncefact:data:standard:crossindustryinvoice')) {
    return 'cii';
  }

  if (lowerContent.includes('urn:oasis:names:specification:ubl:schema:xsd:invoice')) {
    return 'ubl';
  }

  return 'unknown';
}

/**
 * Parse invoice content into structured data.
 * This is a placeholder - returns mock data.
 */
function parseInvoice(content: string, format: InvoiceFormat): ParsedInvoice {
  // In production, this would actually parse the XML/JSON
  // For now, return mock data for demonstration
  const issueDate = new Date().toISOString().split('T')[0] as string;
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  return {
    format,
    invoiceNumber: 'INV-2024-001',
    issueDate,
    dueDate,
    currency: 'EUR',
    totalAmount: 1190.0,
    taxAmount: 190.0,
    seller: {
      name: 'Seller GmbH',
      vatId: 'DE123456789',
      street: 'Musterstraße 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
    },
    buyer: {
      name: 'Buyer AG',
      vatId: 'DE987654321',
      street: 'Beispielweg 2',
      city: 'München',
      postalCode: '80331',
      country: 'DE',
    },
    lineItems: [
      {
        lineNumber: 1,
        description: 'Professional Services',
        quantity: 10,
        unit: 'HUR',
        unitPrice: 100.0,
        lineTotal: 1000.0,
        taxRate: 19,
      },
    ],
  };
}
