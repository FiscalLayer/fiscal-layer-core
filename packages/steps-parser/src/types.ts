/* eslint-disable @typescript-eslint/no-unused-vars -- Imported types used for type reference */
/**
 * Types for the Parser Filter
 */

import type { Diagnostic, InvoiceFormat } from '@fiscal-layer/contracts';

/**
 * Detected invoice format with more granularity
 */
export type DetectedFormat = 'xrechnung' | 'zugferd' | 'peppol-bis' | 'ubl' | 'cii' | 'unknown';

/**
 * Document type detected from invoice
 */
export type DocumentType = 'Invoice' | 'CreditNote' | 'DebitNote' | 'Unknown';

/**
 * Result of format detection
 */
export interface ParserResult {
  /**
   * Detected invoice format
   */
  format: DetectedFormat;

  /**
   * Document type (Invoice, CreditNote, etc.)
   */
  documentType: DocumentType;

  /**
   * Profile identifier (e.g., "urn:factur-x.eu:1p0:basic", "urn:cen.eu:en16931:2017")
   */
  profile?: string;

  /**
   * Customization ID (e.g., "urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0")
   */
  customizationId?: string;

  /**
   * Schema version detected (e.g., "2.2", "3.0")
   */
  schemaVersion?: string;

  /**
   * Namespace detected
   */
  namespace?: string;

  /**
   * Any warnings during detection
   */
  warnings: Diagnostic[];
}

/**
 * Configuration for the Parser Filter
 */
export interface ParserFilterConfig {
  /**
   * Whether to fail on unknown format (default: false - returns warning)
   */
  failOnUnknownFormat?: boolean;

  /**
   * Whether to fail on parse errors (default: true)
   */
  failOnParseError?: boolean;

  /**
   * Maximum XML size in bytes (default: 10MB)
   */
  maxXmlSize?: number;
}

/**
 * Parsed XML structure for internal use
 */
export interface ParsedXml {
  /**
   * Root element name
   */
  rootElement: string;

  /**
   * Namespaces declared
   */
  namespaces: Map<string, string>;

  /**
   * The parsed document object
   */
  document: Record<string, unknown>;
}

/**
 * XML namespace constants for format detection
 */
export const XML_NAMESPACES = {
  // UBL 2.1 namespaces
  UBL_INVOICE: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  UBL_CREDIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  UBL_COMMON_BASIC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  UBL_COMMON_AGGREGATE: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',

  // CII namespaces
  CII_RSM: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  CII_RAM: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  CII_QDT: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  CII_UDT: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',

  // EN16931
  EN16931: 'urn:cen.eu:en16931',
} as const;

/**
 * Profile patterns for format detection
 */
export const FORMAT_PROFILES = {
  XRECHNUNG: [
    'xrechnung',
    'urn:xoev-de:kosit:standard:xrechnung',
    'urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit',
  ],
  ZUGFERD: [
    'zugferd',
    'factur-x',
    'urn:factur-x.eu',
    'urn:zugferd.de',
  ],
  PEPPOL: [
    'peppol',
    'urn:fdc:peppol.eu',
    'urn:www.cenbii.eu:transaction',
  ],
} as const;
