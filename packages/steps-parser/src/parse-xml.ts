/* eslint-disable @typescript-eslint/no-unused-vars -- Imports used for type inference */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- XML navigation requires dynamic access */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- XML parsing produces dynamic types */
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- Explicit as syntax for clarity */
/* eslint-disable @typescript-eslint/no-base-to-string -- Dynamic value conversion */
/* eslint-disable @typescript-eslint/no-unnecessary-type-conversion -- Explicit toString for clarity */
/**
 * XML to CanonicalInvoice Parser
 *
 * Parses UBL and CII invoice XML into the EN16931 CanonicalInvoice format.
 * Implements minimal subset mapping for MVP - tolerant of missing fields.
 *
 * IMPORTANT: No PII is logged during parsing.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  CanonicalInvoice,
  CanonicalParty,
  CanonicalLineItem,
  MonetaryTotals,
  TaxCategory,
  PostalAddress,
  InvoiceTypeCode,
  DecimalAmount,
  ISODate,
  CurrencyCode,
} from '@fiscal-layer/contracts';
import type { DetectedFormat, ParserResult } from './types.js';

/**
 * Parse XML content into CanonicalInvoice (EN16931 minimal subset)
 *
 * Supports:
 * - UBL 2.1 Invoice/CreditNote
 * - UN/CEFACT CII (CrossIndustryInvoice)
 *
 * @param xml - Raw XML content
 * @param format - Detected format from detectInvoiceFormatFromXml
 * @returns CanonicalInvoice structure
 */
export function parseXmlToCanonicalInvoice(
  xml: string,
  formatResult: ParserResult,
): CanonicalInvoice {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true, // Remove namespace prefixes for easier access
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => {
      // Elements that should always be arrays
      const arrayElements = [
        'InvoiceLine',
        'CreditNoteLine',
        'SupplyChainTradeLineItem',
        'TaxSubtotal',
        'ApplicableTradeTax',
        'AllowanceCharge',
        'Note',
        'AdditionalDocumentReference',
        'PartyIdentification',
      ];
      return arrayElements.includes(name);
    },
  });

  const parsed = parser.parse(xml);

  // Determine which parser to use based on root element
  const rootElement = Object.keys(parsed).find((k) => !k.startsWith('?'));

  if (!rootElement) {
    throw new Error('No root element found in XML');
  }

  const rootName = rootElement.toLowerCase();
  const doc = parsed[rootElement];

  // Parse based on format
  if (rootName === 'invoice' || rootName === 'creditnote') {
    return parseUblInvoice(doc, formatResult, rootName === 'creditnote');
  }

  if (rootName === 'crossindustryinvoice') {
    return parseCiiInvoice(doc, formatResult);
  }

  throw new Error(`Unsupported root element: ${rootElement}`);
}

/**
 * Parse UBL Invoice/CreditNote
 */
function parseUblInvoice(
  doc: Record<string, unknown>,
  formatResult: ParserResult,
  isCreditNote: boolean,
): CanonicalInvoice {
  const now = new Date().toISOString();

  // Basic fields
  const invoiceNumber = getTextValue(doc, 'ID') ?? 'UNKNOWN';
  const issueDate = getTextValue(doc, 'IssueDate') ?? (now.split('T')[0] as string);
  const dueDate = getTextValue(doc, 'DueDate');
  const currencyCode = getTextValue(doc, 'DocumentCurrencyCode') ?? 'EUR';

  // Invoice type - map to UNTDID 1001 codes
  const invoiceTypeCode = mapUblInvoiceType(
    getTextValue(doc, 'InvoiceTypeCode') ?? getTextValue(doc, 'CreditNoteTypeCode'),
    isCreditNote,
  );

  // Parties
  const seller = parseUblParty(getNestedObject(doc, 'AccountingSupplierParty.Party'));
  const buyer = parseUblParty(getNestedObject(doc, 'AccountingCustomerParty.Party'));

  // Line items
  const lines = isCreditNote ? doc['CreditNoteLine'] : doc['InvoiceLine'];
  const lineItems = parseUblLineItems(lines, currencyCode);

  // Totals
  const totals = parseUblTotals(doc, currencyCode);

  // Buyer reference
  const buyerReference = getTextValue(doc, 'BuyerReference');

  // Notes
  const notes = extractNotes(doc['Note']);

  const result: CanonicalInvoice = {
    originalFormat: formatResult.format as CanonicalInvoice['originalFormat'],
    invoiceTypeCode,
    invoiceNumber,
    issueDate,
    currencyCode,
    seller,
    buyer,
    lineItems,
    totals,
    _meta: {
      parsedAt: now,
      parserVersion: '0.0.1',
    },
  };

  // Conditionally add optional properties (exactOptionalPropertyTypes)
  if (dueDate) result.dueDate = dueDate;
  if (buyerReference) result.buyerReference = buyerReference;
  if (notes.length > 0) result.notes = notes;
  if (formatResult.schemaVersion && result._meta) {
    result._meta.schemaVersion = formatResult.schemaVersion;
  }

  return result;
}

/**
 * Parse UN/CEFACT CII (CrossIndustryInvoice)
 */
function parseCiiInvoice(
  doc: Record<string, unknown>,
  formatResult: ParserResult,
): CanonicalInvoice {
  const now = new Date().toISOString();

  // CII structure: ExchangedDocument, SupplyChainTradeTransaction
  const exchangedDoc = getNestedObject(doc, 'ExchangedDocument') ?? {};
  const tradeTransaction = getNestedObject(doc, 'SupplyChainTradeTransaction') ?? {};
  const headerAgreement = getNestedObject(tradeTransaction, 'ApplicableHeaderTradeAgreement') ?? {};
  const headerDelivery = getNestedObject(tradeTransaction, 'ApplicableHeaderTradeDelivery') ?? {};
  const headerSettlement =
    getNestedObject(tradeTransaction, 'ApplicableHeaderTradeSettlement') ?? {};

  // Basic fields
  const invoiceNumber = getTextValue(exchangedDoc, 'ID') ?? 'UNKNOWN';
  const issueDateObj = getNestedObject(exchangedDoc, 'IssueDateTime.DateTimeString');
  const issueDate = parseCiiDate(issueDateObj) ?? (now.split('T')[0] as string);

  const currencyCode = getTextValue(headerSettlement, 'InvoiceCurrencyCode') ?? 'EUR';

  // Invoice type
  const typeCode = getTextValue(exchangedDoc, 'TypeCode');
  const invoiceTypeCode = mapCiiInvoiceType(typeCode);

  // Parties
  const seller = parseCiiParty(getNestedObject(headerAgreement, 'SellerTradeParty'));
  const buyer = parseCiiParty(getNestedObject(headerAgreement, 'BuyerTradeParty'));

  // Line items
  const lineItems = parseCiiLineItems(
    tradeTransaction['IncludedSupplyChainTradeLineItem'],
    currencyCode,
  );

  // Totals
  const totals = parseCiiTotals(headerSettlement, currencyCode);

  // Buyer reference
  const buyerReference = getTextValue(headerAgreement, 'BuyerReference');

  // Notes
  const notes = extractCiiNotes(exchangedDoc['IncludedNote']);

  // Due date
  const paymentTerms = getNestedObject(headerSettlement, 'SpecifiedTradePaymentTerms');
  const dueDateObj = getNestedObject(paymentTerms, 'DueDateDateTime.DateTimeString');
  const dueDate = parseCiiDate(dueDateObj);

  const result: CanonicalInvoice = {
    originalFormat: formatResult.format as CanonicalInvoice['originalFormat'],
    invoiceTypeCode,
    invoiceNumber,
    issueDate,
    currencyCode,
    seller,
    buyer,
    lineItems,
    totals,
    _meta: {
      parsedAt: now,
      parserVersion: '0.0.1',
    },
  };

  // Conditionally add optional properties (exactOptionalPropertyTypes)
  if (dueDate) result.dueDate = dueDate;
  if (buyerReference) result.buyerReference = buyerReference;
  if (notes.length > 0) result.notes = notes;
  if (formatResult.schemaVersion && result._meta) {
    result._meta.schemaVersion = formatResult.schemaVersion;
  }

  return result;
}

// ============================================================================
// UBL Parser Helpers
// ============================================================================

function parseUblParty(party: Record<string, unknown> | null): CanonicalParty {
  if (!party) {
    return { name: 'Unknown' };
  }

  const partyName = getNestedObject(party, 'PartyName');
  const name =
    getTextValue(partyName, 'Name') ??
    getTextValue(getNestedObject(party, 'PartyLegalEntity'), 'RegistrationName') ??
    'Unknown';

  const postalAddress = parseUblAddress(getNestedObject(party, 'PostalAddress'));
  const vatId = getTextValue(getNestedObject(party, 'PartyTaxScheme'), 'CompanyID');

  const result: CanonicalParty = { name };
  if (vatId) result.vatId = vatId;
  if (postalAddress) result.postalAddress = postalAddress;
  return result;
}

function parseUblAddress(address: Record<string, unknown> | null): PostalAddress | undefined {
  if (!address) {
    return undefined;
  }

  const countryCode =
    getTextValue(getNestedObject(address, 'Country'), 'IdentificationCode') ?? 'XX';
  const streetName = getTextValue(address, 'StreetName');
  const additionalStreetName = getTextValue(address, 'AdditionalStreetName');
  const cityName = getTextValue(address, 'CityName');
  const postalZone = getTextValue(address, 'PostalZone');
  const countrySubdivision = getTextValue(address, 'CountrySubentity');

  const result: PostalAddress = { countryCode };
  if (streetName) result.streetName = streetName;
  if (additionalStreetName) result.additionalStreetName = additionalStreetName;
  if (cityName) result.cityName = cityName;
  if (postalZone) result.postalZone = postalZone;
  if (countrySubdivision) result.countrySubdivision = countrySubdivision;
  return result;
}

function parseUblLineItems(lines: unknown, currencyCode: string): CanonicalLineItem[] {
  if (!lines || !Array.isArray(lines)) {
    return [];
  }

  return lines.map((line: Record<string, unknown>, index: number) => {
    const id = getTextValue(line, 'ID') ?? String(index + 1);
    const item = getNestedObject(line, 'Item') ?? {};

    const description = getTextValue(item, 'Description') ?? getTextValue(item, 'Name') ?? 'Item';

    const quantity =
      getTextValue(line, 'InvoicedQuantity') ?? getTextValue(line, 'CreditedQuantity') ?? '1';
    const unitCode =
      getAttributeValue(line, 'InvoicedQuantity', '@_unitCode') ??
      getAttributeValue(line, 'CreditedQuantity', '@_unitCode') ??
      'C62';

    const priceObj = getNestedObject(line, 'Price');
    const unitPrice = getTextValue(priceObj, 'PriceAmount') ?? '0';
    const baseQuantity = getTextValue(priceObj, 'BaseQuantity') ?? '1';

    const lineNetAmount = getTextValue(line, 'LineExtensionAmount') ?? '0';

    // Tax category
    const taxCategoryObj =
      getNestedObject(item, 'ClassifiedTaxCategory') ??
      getNestedObject(line, 'TaxTotal.TaxSubtotal.TaxCategory');
    const taxCategory = parseUblTaxCategory(taxCategoryObj, lineNetAmount);

    return {
      id,
      description,
      quantity: normalizeDecimal(quantity),
      unitCode,
      unitPrice: normalizeDecimal(unitPrice),
      baseQuantity: normalizeDecimal(baseQuantity),
      lineNetAmount: normalizeDecimal(lineNetAmount),
      taxCategory,
    };
  });
}

function parseUblTaxCategory(
  category: Record<string, unknown> | null,
  baseAmount: string,
): TaxCategory {
  if (!category) {
    return {
      code: 'S',
      rate: '0',
      taxableAmount: normalizeDecimal(baseAmount),
      taxAmount: '0',
    };
  }

  return {
    code: getTextValue(category, 'ID') ?? 'S',
    rate: normalizeDecimal(getTextValue(category, 'Percent') ?? '0'),
    taxableAmount: normalizeDecimal(baseAmount),
    taxAmount: '0', // Will be calculated
  };
}

function parseUblTotals(doc: Record<string, unknown>, currencyCode: string): MonetaryTotals {
  const legalMonetaryTotal = getNestedObject(doc, 'LegalMonetaryTotal') ?? {};
  const taxTotal = getNestedObject(doc, 'TaxTotal') ?? {};

  const lineExtensionAmount = normalizeDecimal(
    getTextValue(legalMonetaryTotal, 'LineExtensionAmount') ?? '0',
  );
  const taxExclusiveAmount = normalizeDecimal(
    getTextValue(legalMonetaryTotal, 'TaxExclusiveAmount') ?? lineExtensionAmount,
  );
  const taxAmount = normalizeDecimal(getTextValue(taxTotal, 'TaxAmount') ?? '0');
  const taxInclusiveAmount = normalizeDecimal(
    getTextValue(legalMonetaryTotal, 'TaxInclusiveAmount') ?? '0',
  );
  const payableAmount = normalizeDecimal(
    getTextValue(legalMonetaryTotal, 'PayableAmount') ?? taxInclusiveAmount,
  );

  // Tax breakdown
  const taxSubtotals = taxTotal['TaxSubtotal'];
  const taxBreakdown = parseUblTaxBreakdown(taxSubtotals);

  return {
    lineExtensionAmount,
    taxExclusiveAmount,
    taxAmount,
    taxBreakdown:
      taxBreakdown.length > 0
        ? taxBreakdown
        : [
            {
              code: 'S',
              rate: '19',
              taxableAmount: taxExclusiveAmount,
              taxAmount,
            },
          ],
    taxInclusiveAmount,
    payableAmount,
  };
}

function parseUblTaxBreakdown(subtotals: unknown): TaxCategory[] {
  if (!subtotals || !Array.isArray(subtotals)) {
    return [];
  }

  return subtotals.map((subtotal: Record<string, unknown>) => {
    const category = getNestedObject(subtotal, 'TaxCategory') ?? {};

    return {
      code: getTextValue(category, 'ID') ?? 'S',
      rate: normalizeDecimal(getTextValue(category, 'Percent') ?? '0'),
      taxableAmount: normalizeDecimal(getTextValue(subtotal, 'TaxableAmount') ?? '0'),
      taxAmount: normalizeDecimal(getTextValue(subtotal, 'TaxAmount') ?? '0'),
    };
  });
}

// ============================================================================
// CII Parser Helpers
// ============================================================================

function parseCiiParty(party: Record<string, unknown> | null): CanonicalParty {
  if (!party) {
    return { name: 'Unknown' };
  }

  const name = getTextValue(party, 'Name') ?? 'Unknown';
  const postalAddress = parseCiiAddress(getNestedObject(party, 'PostalTradeAddress'));

  // VAT ID from tax registration
  const taxRegistration = getNestedObject(party, 'SpecifiedTaxRegistration');
  const vatId = getTextValue(taxRegistration, 'ID');

  const result: CanonicalParty = { name };
  if (vatId) result.vatId = vatId;
  if (postalAddress) result.postalAddress = postalAddress;
  return result;
}

function parseCiiAddress(address: Record<string, unknown> | null): PostalAddress | undefined {
  if (!address) {
    return undefined;
  }

  const countryCode = getTextValue(address, 'CountryID') ?? 'XX';
  const streetName = getTextValue(address, 'LineOne');
  const additionalStreetName = getTextValue(address, 'LineTwo');
  const cityName = getTextValue(address, 'CityName');
  const postalZone = getTextValue(address, 'PostcodeCode');
  const countrySubdivision = getTextValue(address, 'CountrySubDivisionName');

  const result: PostalAddress = { countryCode };
  if (streetName) result.streetName = streetName;
  if (additionalStreetName) result.additionalStreetName = additionalStreetName;
  if (cityName) result.cityName = cityName;
  if (postalZone) result.postalZone = postalZone;
  if (countrySubdivision) result.countrySubdivision = countrySubdivision;
  return result;
}

function parseCiiLineItems(lines: unknown, currencyCode: string): CanonicalLineItem[] {
  if (!lines) {
    return [];
  }

  const lineArray = Array.isArray(lines) ? lines : [lines];

  return lineArray.map((line: Record<string, unknown>, index: number) => {
    const doc = getNestedObject(line, 'AssociatedDocumentLineDocument') ?? {};
    const product = getNestedObject(line, 'SpecifiedTradeProduct') ?? {};
    const agreement = getNestedObject(line, 'SpecifiedLineTradeAgreement') ?? {};
    const delivery = getNestedObject(line, 'SpecifiedLineTradeDelivery') ?? {};
    const settlement = getNestedObject(line, 'SpecifiedLineTradeSettlement') ?? {};

    const id = getTextValue(doc, 'LineID') ?? String(index + 1);
    const description = getTextValue(product, 'Name') ?? 'Item';

    // Quantity - CII uses nested structure
    const billedQty = getNestedObject(delivery, 'BilledQuantity');
    const quantity = extractTextFromValue(billedQty) ?? '1';
    const unitCode = getAttrFromObject(billedQty, '@_unitCode') ?? 'C62';

    // Price - ChargeAmount may be nested
    const priceObj = getNestedObject(agreement, 'NetPriceProductTradePrice');
    const chargeAmountObj = getNestedObject(priceObj, 'ChargeAmount');
    const unitPrice =
      extractTextFromValue(chargeAmountObj) ?? getTextValue(priceObj, 'ChargeAmount') ?? '0';

    // Line total
    const summation = getNestedObject(settlement, 'SpecifiedTradeSettlementLineMonetarySummation');
    const lineNetAmount = getTextValue(summation, 'LineTotalAmount') ?? '0';

    // Tax
    const tradeTax = getNestedObject(settlement, 'ApplicableTradeTax');
    const taxCategory = parseCiiTaxCategory(tradeTax, lineNetAmount);

    return {
      id,
      description,
      quantity: normalizeDecimal(quantity),
      unitCode,
      unitPrice: normalizeDecimal(unitPrice),
      lineNetAmount: normalizeDecimal(lineNetAmount),
      taxCategory,
    };
  });
}

function parseCiiTaxCategory(tax: Record<string, unknown> | null, baseAmount: string): TaxCategory {
  if (!tax) {
    return {
      code: 'S',
      rate: '0',
      taxableAmount: normalizeDecimal(baseAmount),
      taxAmount: '0',
    };
  }

  return {
    code: getTextValue(tax, 'CategoryCode') ?? getTextValue(tax, 'TypeCode') ?? 'S',
    rate: normalizeDecimal(getTextValue(tax, 'RateApplicablePercent') ?? '0'),
    taxableAmount: normalizeDecimal(getTextValue(tax, 'BasisAmount') ?? baseAmount),
    taxAmount: normalizeDecimal(getTextValue(tax, 'CalculatedAmount') ?? '0'),
  };
}

function parseCiiTotals(settlement: Record<string, unknown>, currencyCode: string): MonetaryTotals {
  const summation =
    getNestedObject(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation') ?? {};

  const lineExtensionAmount = normalizeDecimal(getTextValue(summation, 'LineTotalAmount') ?? '0');
  const taxExclusiveAmount = normalizeDecimal(
    getTextValue(summation, 'TaxBasisTotalAmount') ?? lineExtensionAmount,
  );
  const taxAmount = normalizeDecimal(getTextValue(summation, 'TaxTotalAmount') ?? '0');
  const taxInclusiveAmount = normalizeDecimal(getTextValue(summation, 'GrandTotalAmount') ?? '0');
  const payableAmount = normalizeDecimal(
    getTextValue(summation, 'DuePayableAmount') ?? taxInclusiveAmount,
  );

  // Tax breakdown
  const tradeTaxes = settlement['ApplicableTradeTax'];
  const taxBreakdown = parseCiiTaxBreakdown(tradeTaxes);

  return {
    lineExtensionAmount,
    taxExclusiveAmount,
    taxAmount,
    taxBreakdown:
      taxBreakdown.length > 0
        ? taxBreakdown
        : [
            {
              code: 'S',
              rate: '19',
              taxableAmount: taxExclusiveAmount,
              taxAmount,
            },
          ],
    taxInclusiveAmount,
    payableAmount,
  };
}

function parseCiiTaxBreakdown(taxes: unknown): TaxCategory[] {
  if (!taxes) {
    return [];
  }

  const taxArray = Array.isArray(taxes) ? taxes : [taxes];

  return taxArray.map((tax: Record<string, unknown>) => ({
    code: getTextValue(tax, 'CategoryCode') ?? getTextValue(tax, 'TypeCode') ?? 'S',
    rate: normalizeDecimal(getTextValue(tax, 'RateApplicablePercent') ?? '0'),
    taxableAmount: normalizeDecimal(getTextValue(tax, 'BasisAmount') ?? '0'),
    taxAmount: normalizeDecimal(getTextValue(tax, 'CalculatedAmount') ?? '0'),
  }));
}

function parseCiiDate(dateObj: unknown): string | null {
  if (!dateObj) {
    return null;
  }

  // CII dates can be in format 20240123 or with text content
  let dateStr: string;

  if (typeof dateObj === 'string') {
    dateStr = dateObj;
  } else if (typeof dateObj === 'number') {
    // fast-xml-parser may convert numeric dates to numbers
    dateStr = String(dateObj);
  } else if (typeof dateObj === 'object' && dateObj !== null) {
    const obj = dateObj as Record<string, unknown>;
    // Ensure we convert to string (fast-xml-parser may return number)
    const rawValue = obj['#text'] ?? obj['_'];
    dateStr = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
  } else {
    return null;
  }

  // Convert YYYYMMDD to YYYY-MM-DD
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split('T')[0] as string;
  }

  return dateStr;
}

function extractCiiNotes(notes: unknown): string[] {
  if (!notes) {
    return [];
  }

  const noteArray = Array.isArray(notes) ? notes : [notes];

  return noteArray
    .map((note: Record<string, unknown>) => getTextValue(note, 'Content'))
    .filter((n): n is string => n !== null);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get text value from object, handling various XML formats
 */
function getTextValue(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;

  const value = obj[key];
  return extractTextFromValue(value);
}

/**
 * Extract text content directly from a value (for CII nested structures)
 */
function extractTextFromValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // Handle XML text content
    if ('#text' in v) return String(v['#text']);
    if ('_' in v) return String(v['_']);
    // Sometimes the value is the first property
    const keys = Object.keys(v).filter((k) => !k.startsWith('@'));
    if (keys[0]) {
      const firstVal = v[keys[0]];
      if (typeof firstVal === 'string' || typeof firstVal === 'number') {
        return String(firstVal);
      }
    }
  }

  return null;
}

/**
 * Get attribute value directly from an object
 */
function getAttrFromObject(
  obj: Record<string, unknown> | null | undefined,
  attrKey: string,
): string | null {
  if (!obj) return null;
  const attr = obj[attrKey];
  if (typeof attr === 'string') {
    return attr;
  }
  return null;
}

/**
 * Get nested object using dot notation path
 */
function getNestedObject(
  obj: Record<string, unknown> | null | undefined,
  path: string,
): Record<string, unknown> | null {
  if (!obj) return null;

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current !== null && typeof current === 'object') {
    return current as Record<string, unknown>;
  }

  return null;
}

/**
 * Get attribute value from element
 */
function getAttributeValue(
  obj: Record<string, unknown> | null | undefined,
  elementKey: string,
  attrKey: string,
): string | null {
  if (!obj) return null;

  const element = obj[elementKey];
  if (element && typeof element === 'object') {
    const el = element as Record<string, unknown>;
    const attr = el[attrKey];
    if (typeof attr === 'string') {
      return attr;
    }
  }

  return null;
}

/**
 * Normalize decimal string (remove extra spaces, ensure valid format)
 */
function normalizeDecimal(value: string | null | undefined): DecimalAmount {
  if (!value) return '0';

  const cleaned = value.toString().trim().replace(/\s/g, '');

  // Validate it looks like a number
  if (!/^-?\d*\.?\d+$/.test(cleaned)) {
    return '0';
  }

  return cleaned;
}

/**
 * Extract notes from UBL Note elements
 */
function extractNotes(notes: unknown): string[] {
  if (!notes) {
    return [];
  }

  if (typeof notes === 'string') {
    return [notes];
  }

  if (Array.isArray(notes)) {
    return notes
      .map((n: unknown) => {
        if (typeof n === 'string') return n;
        if (typeof n === 'object' && n !== null) {
          const obj = n as Record<string, unknown>;
          return obj['#text'] ?? obj['_'];
        }
        return null;
      })
      .filter((n): n is string => typeof n === 'string');
  }

  return [];
}

/**
 * Map UBL InvoiceTypeCode to UNTDID 1001
 */
function mapUblInvoiceType(typeCode: string | null, isCreditNote: boolean): InvoiceTypeCode {
  if (isCreditNote) {
    return '381'; // Credit Note
  }

  switch (typeCode) {
    case '380':
      return '380'; // Commercial Invoice
    case '381':
      return '381'; // Credit Note
    case '383':
      return '383'; // Debit Note
    case '384':
      return '384'; // Corrected Invoice
    case '386':
      return '386'; // Prepayment Invoice
    case '389':
      return '389'; // Self-billed Invoice
    case '751':
      return '751'; // Invoice Information
    default:
      return '380'; // Default to Commercial Invoice
  }
}

/**
 * Map CII TypeCode to UNTDID 1001
 */
function mapCiiInvoiceType(typeCode: string | null): InvoiceTypeCode {
  switch (typeCode) {
    case '380':
      return '380';
    case '381':
      return '381';
    case '383':
      return '383';
    case '384':
      return '384';
    case '386':
      return '386';
    case '389':
      return '389';
    case '751':
      return '751';
    default:
      return '380';
  }
}
