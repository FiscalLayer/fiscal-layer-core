/**
 * Supported invoice formats
 *
 * Note: PDF is treated as a single format type. The distinction between
 * pdf-text and pdf-scanned is tracked via DocumentNature in extensions.
 */
export type InvoiceFormat = 'xrechnung' | 'zugferd' | 'peppol-bis' | 'ubl' | 'cii' | 'pdf' | 'unknown';

/**
 * Raw invoice input before parsing
 */
export interface RawInvoice {
  /** Original content (XML or JSON string) */
  content: string;

  /**
   * Content type hint
   *
   * For PDF files, content should be base64-encoded with optional
   * 'data:application/pdf;base64,' prefix.
   */
  contentType?: 'application/xml' | 'application/json' | 'text/xml' | 'application/pdf';

  /** Format hint (if known by caller) */
  formatHint?: InvoiceFormat;

  /** Original filename (for diagnostics) */
  filename?: string;
}

/**
 * Parsed invoice data extracted by the Parser filter
 */
export interface ParsedInvoice {
  /** Detected format */
  format: InvoiceFormat;

  /** Invoice number */
  invoiceNumber?: string;

  /** Issue date (ISO 8601) */
  issueDate?: string;

  /** Due date (ISO 8601) */
  dueDate?: string;

  /** Currency code (ISO 4217) */
  currency?: string;

  /** Total amount */
  totalAmount?: number;

  /** Tax amount */
  taxAmount?: number;

  /** Seller information */
  seller?: PartyInfo;

  /** Buyer information */
  buyer?: PartyInfo;

  /** Line items */
  lineItems?: LineItem[];

  /** Additional parsed fields (format-specific) */
  extensions?: Record<string, unknown>;
}

/**
 * Party (seller/buyer) information
 */
export interface PartyInfo {
  /** Legal name */
  name?: string;

  /** VAT identification number */
  vatId?: string;

  /** Tax registration number */
  taxNumber?: string;

  /** Street address */
  street?: string;

  /** City */
  city?: string;

  /** Postal code */
  postalCode?: string;

  /** Country code (ISO 3166-1 alpha-2) */
  country?: string;

  /** Contact email (PII - will be masked) */
  email?: string;

  /** Contact phone (PII - will be masked) */
  phone?: string;
}

/**
 * Invoice line item
 */
export interface LineItem {
  /** Line number */
  lineNumber?: number;

  /** Item description */
  description?: string;

  /** Quantity */
  quantity?: number;

  /** Unit of measure */
  unit?: string;

  /** Unit price */
  unitPrice?: number;

  /** Line total */
  lineTotal?: number;

  /** Tax rate (percentage) */
  taxRate?: number;
}
