/**
 * CanonicalInvoice represents the EN16931 minimal subset with extensions.
 *
 * This is the normalized representation used throughout the pipeline.
 * All monetary amounts are stored as string decimal values to avoid
 * floating-point precision issues.
 *
 * @see https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/
 * @see https://en.wikipedia.org/wiki/EN_16931
 */

import type { InvoiceFormat } from './invoice.js';

/**
 * Decimal amount represented as string to avoid floating-point issues.
 * Use with decimal.js or similar library for arithmetic operations.
 *
 * @example "1234.56", "-100.00", "0.01"
 */
export type DecimalAmount = string;

/**
 * ISO 4217 currency code
 * @example "EUR", "USD", "GBP"
 */
export type CurrencyCode = string;

/**
 * ISO 8601 date string
 * @example "2024-01-23"
 */
export type ISODate = string;

/**
 * Party identifier with scheme
 */
export interface PartyIdentifier {
  /**
   * Identifier value
   */
  value: string;

  /**
   * Identifier scheme (e.g., "0088" for EAN, "0060" for DUNS)
   */
  schemeId?: string;
}

/**
 * Tax category according to EN16931
 */
export interface TaxCategory {
  /**
   * Tax category code (e.g., "S" = Standard, "Z" = Zero, "E" = Exempt)
   */
  code: string;

  /**
   * Tax rate as decimal (e.g., "19.00" for 19%)
   */
  rate: DecimalAmount;

  /**
   * Taxable base amount
   */
  taxableAmount: DecimalAmount;

  /**
   * Calculated tax amount
   */
  taxAmount: DecimalAmount;

  /**
   * Exemption reason (required for exempt categories)
   */
  exemptionReason?: string;

  /**
   * VAT exemption reason code
   */
  exemptionReasonCode?: string;
}

/**
 * Address according to EN16931
 */
export interface PostalAddress {
  /**
   * Street name and house number
   */
  streetName?: string;

  /**
   * Additional street line
   */
  additionalStreetName?: string;

  /**
   * City name
   */
  cityName?: string;

  /**
   * Postal zone / ZIP code
   */
  postalZone?: string;

  /**
   * Country subdivision (state, province)
   */
  countrySubdivision?: string;

  /**
   * Country code (ISO 3166-1 alpha-2)
   */
  countryCode: string;
}

/**
 * Party (seller/buyer) according to EN16931
 */
export interface CanonicalParty {
  /**
   * Party identifiers (GLN, DUNS, etc.)
   */
  identifiers?: PartyIdentifier[];

  /**
   * Legal name
   */
  name: string;

  /**
   * Trading name (if different from legal name)
   */
  tradingName?: string;

  /**
   * VAT identifier (with country prefix)
   */
  vatId?: string;

  /**
   * Tax registration number
   */
  taxRegistrationId?: string;

  /**
   * Postal address
   */
  postalAddress?: PostalAddress;

  /**
   * Electronic address (e.g., Peppol ID)
   */
  electronicAddress?: PartyIdentifier;

  /**
   * Contact email (PII - will be masked)
   */
  email?: string;

  /**
   * Contact phone (PII - will be masked)
   */
  phone?: string;

  /**
   * Contact name (PII - will be masked)
   */
  contactName?: string;

  /**
   * Bank account IBAN (PII - will be masked)
   */
  iban?: string;

  /**
   * Bank BIC/SWIFT code
   */
  bic?: string;
}

/**
 * Line item according to EN16931
 */
export interface CanonicalLineItem {
  /**
   * Line identifier
   */
  id: string;

  /**
   * Item description
   */
  description: string;

  /**
   * Seller's item identifier
   */
  sellerItemId?: string;

  /**
   * Buyer's item identifier
   */
  buyerItemId?: string;

  /**
   * Standard item identifier (e.g., GTIN)
   */
  standardItemId?: PartyIdentifier;

  /**
   * Invoiced quantity
   */
  quantity: DecimalAmount;

  /**
   * Unit of measure code (UN/ECE Recommendation 20)
   */
  unitCode: string;

  /**
   * Price per unit (net)
   */
  unitPrice: DecimalAmount;

  /**
   * Price base quantity
   * @default "1"
   */
  baseQuantity?: DecimalAmount;

  /**
   * Line allowances
   */
  allowances?: AllowanceCharge[];

  /**
   * Line charges
   */
  charges?: AllowanceCharge[];

  /**
   * Line net amount
   */
  lineNetAmount: DecimalAmount;

  /**
   * Tax category for this line
   */
  taxCategory: TaxCategory;

  /**
   * Accounting cost code
   */
  accountingCost?: string;

  /**
   * Order line reference
   */
  orderLineReference?: string;

  /**
   * Item classification codes
   */
  classificationCodes?: PartyIdentifier[];
}

/**
 * Allowance or charge
 */
export interface AllowanceCharge {
  /**
   * Whether this is a charge (true) or allowance (false)
   */
  isCharge: boolean;

  /**
   * Reason code
   */
  reasonCode?: string;

  /**
   * Reason text
   */
  reason?: string;

  /**
   * Amount
   */
  amount: DecimalAmount;

  /**
   * Base amount for percentage calculation
   */
  baseAmount?: DecimalAmount;

  /**
   * Percentage
   */
  percentage?: DecimalAmount;

  /**
   * Tax category
   */
  taxCategory?: TaxCategory;
}

/**
 * Payment terms
 */
export interface PaymentTerms {
  /**
   * Payment terms text
   */
  note?: string;

  /**
   * Due date
   */
  dueDate?: ISODate;

  /**
   * Payment means code (UN/EDIFACT 4461)
   */
  paymentMeansCode?: string;

  /**
   * Payment ID / reference
   */
  paymentId?: string;
}

/**
 * Document reference (e.g., order, contract, despatch advice)
 */
export interface DocumentReference {
  /**
   * Reference type
   */
  type: 'order' | 'contract' | 'despatch' | 'receipt' | 'originator' | 'preceding';

  /**
   * Reference ID
   */
  id: string;

  /**
   * Issue date
   */
  issueDate?: ISODate;
}

/**
 * Monetary totals
 */
export interface MonetaryTotals {
  /**
   * Sum of line net amounts
   */
  lineExtensionAmount: DecimalAmount;

  /**
   * Total allowances on document level
   */
  allowanceTotalAmount?: DecimalAmount;

  /**
   * Total charges on document level
   */
  chargeTotalAmount?: DecimalAmount;

  /**
   * Net amount before tax
   */
  taxExclusiveAmount: DecimalAmount;

  /**
   * Total tax amount
   */
  taxAmount: DecimalAmount;

  /**
   * Tax breakdown by category
   */
  taxBreakdown: TaxCategory[];

  /**
   * Total amount with tax
   */
  taxInclusiveAmount: DecimalAmount;

  /**
   * Prepaid amount
   */
  prepaidAmount?: DecimalAmount;

  /**
   * Rounding adjustment
   */
  roundingAmount?: DecimalAmount;

  /**
   * Amount due for payment
   */
  payableAmount: DecimalAmount;
}

/**
 * Invoice type codes (subset of UNTDID 1001)
 */
export type InvoiceTypeCode =
  | '380' // Commercial Invoice
  | '381' // Credit Note
  | '383' // Debit Note
  | '384' // Corrected Invoice
  | '386' // Prepayment Invoice
  | '389' // Self-billed Invoice
  | '751'; // Invoice Information for Accounting

/**
 * CanonicalInvoice is the EN16931 normalized representation.
 *
 * All amounts use DecimalAmount (string) to preserve precision.
 * Use decimal.js for arithmetic operations.
 */
export interface CanonicalInvoice {
  /**
   * Original format detected
   */
  originalFormat: InvoiceFormat;

  /**
   * Invoice type code
   */
  invoiceTypeCode: InvoiceTypeCode;

  /**
   * Invoice number
   */
  invoiceNumber: string;

  /**
   * Issue date
   */
  issueDate: ISODate;

  /**
   * Due date (if specified)
   */
  dueDate?: ISODate;

  /**
   * Tax point date (if different from issue date)
   */
  taxPointDate?: ISODate;

  /**
   * Document currency code (ISO 4217)
   */
  currencyCode: CurrencyCode;

  /**
   * Tax currency code (if different from document currency)
   */
  taxCurrencyCode?: CurrencyCode;

  /**
   * Buyer's reference / purchase order number
   */
  buyerReference?: string;

  /**
   * Project reference
   */
  projectReference?: string;

  /**
   * Document references (orders, contracts, etc.)
   */
  documentReferences?: DocumentReference[];

  /**
   * Seller party
   */
  seller: CanonicalParty;

  /**
   * Buyer party
   */
  buyer: CanonicalParty;

  /**
   * Payee (if different from seller)
   */
  payee?: CanonicalParty;

  /**
   * Tax representative (if applicable)
   */
  taxRepresentative?: CanonicalParty;

  /**
   * Delivery information
   */
  delivery?: {
    deliveryDate?: ISODate;
    deliveryLocation?: PostalAddress;
  };

  /**
   * Payment terms
   */
  paymentTerms?: PaymentTerms;

  /**
   * Document-level allowances
   */
  allowances?: AllowanceCharge[];

  /**
   * Document-level charges
   */
  charges?: AllowanceCharge[];

  /**
   * Line items
   */
  lineItems: CanonicalLineItem[];

  /**
   * Monetary totals
   */
  totals: MonetaryTotals;

  /**
   * Notes (free text)
   */
  notes?: string[];

  /**
   * Invoice period (for recurring/period invoices)
   */
  invoicePeriod?: {
    startDate: ISODate;
    endDate: ISODate;
  };

  /**
   * Extensions for format-specific fields not in EN16931
   */
  extensions?: Record<string, unknown>;

  /**
   * Processing metadata (not from the invoice itself)
   */
  _meta?: {
    /**
     * When the invoice was parsed
     */
    parsedAt: string;

    /**
     * Parser version
     */
    parserVersion: string;

    /**
     * Schema version detected
     */
    schemaVersion?: string;

    /**
     * Original file hash (for deduplication)
     */
    contentHash?: string;
  };
}

/**
 * Type guard to check if an object is a CanonicalInvoice
 */
export function isCanonicalInvoice(obj: unknown): obj is CanonicalInvoice {
  if (typeof obj !== 'object' || obj === null) return false;
  const inv = obj as Partial<CanonicalInvoice>;
  return (
    typeof inv.invoiceNumber === 'string' &&
    typeof inv.issueDate === 'string' &&
    typeof inv.currencyCode === 'string' &&
    typeof inv.seller === 'object' &&
    typeof inv.buyer === 'object' &&
    Array.isArray(inv.lineItems) &&
    typeof inv.totals === 'object'
  );
}
