/* eslint-disable @typescript-eslint/no-unused-vars -- Imports used for type inference */
/* eslint-disable @typescript-eslint/prefer-regexp-exec -- match() used for clarity */
/**
 * Invoice Format Detection
 *
 * Detects XRechnung, ZUGFeRD, Peppol-BIS, UBL, CII formats from XML content.
 * No PII is extracted or logged during detection.
 */

import { XMLParser } from 'fast-xml-parser';
import type { Diagnostic } from '@fiscal-layer/contracts';
import type { DetectedFormat, DocumentType, ParserResult } from './types.js';
import { XML_NAMESPACES, FORMAT_PROFILES } from './types.js';

/**
 * Detects invoice format from XML content.
 *
 * Detection rules (MVP):
 * 1. XRechnung: UBL/CII with XRechnung customization ID or profile
 * 2. ZUGFeRD/Factur-X: CII with ZUGFeRD/Factur-X profile identifier
 * 3. Peppol-BIS: UBL with Peppol customization ID
 * 4. UBL: Generic UBL Invoice/CreditNote
 * 5. CII: Generic CrossIndustryInvoice
 * 6. Unknown: Cannot determine format
 *
 * @param xml - Raw XML content
 * @returns ParserResult with detected format and metadata
 */
export function detectInvoiceFormatFromXml(xml: string): ParserResult {
  const warnings: Diagnostic[] = [];

  // Basic validation
  if (!xml || xml.trim().length === 0) {
    return {
      format: 'unknown',
      documentType: 'Unknown',
      warnings: [
        {
          code: 'PARSE-001',
          message: 'Empty XML content',
          severity: 'error',
          category: 'format',
          source: 'steps-parser',
        },
      ],
    };
  }

  // Check if it looks like XML
  const trimmedXml = xml.trim();
  if (!trimmedXml.startsWith('<?xml') && !trimmedXml.startsWith('<')) {
    return {
      format: 'unknown',
      documentType: 'Unknown',
      warnings: [
        {
          code: 'PARSE-002',
          message: 'Content does not appear to be XML',
          severity: 'error',
          category: 'format',
          source: 'steps-parser',
        },
      ],
    };
  }

  try {
    // Extract namespaces and root element without full parsing
    const rootInfo = extractRootInfo(xml);
    const namespaces = extractNamespaces(xml);

    // Detect document type
    const documentType = detectDocumentType(rootInfo.rootElement);

    // Detect format based on namespaces and content
    const formatInfo = detectFormat(xml, rootInfo, namespaces);

    // Build result with conditional properties (exactOptionalPropertyTypes)
    const result: ParserResult = {
      format: formatInfo.format,
      documentType,
      warnings,
    };
    if (formatInfo.profile) result.profile = formatInfo.profile;
    if (formatInfo.customizationId) result.customizationId = formatInfo.customizationId;
    if (formatInfo.schemaVersion) result.schemaVersion = formatInfo.schemaVersion;
    if (formatInfo.namespace) result.namespace = formatInfo.namespace;

    return result;
  } catch (error) {
    const err = error as Error;
    return {
      format: 'unknown',
      documentType: 'Unknown',
      warnings: [
        {
          code: 'PARSE-003',
          message: `Failed to detect format: ${err.message}`,
          severity: 'error',
          category: 'format',
          source: 'steps-parser',
        },
      ],
    };
  }
}

interface RootInfo {
  rootElement: string;
  localName: string;
  prefix?: string;
}

interface FormatInfo {
  format: DetectedFormat;
  profile?: string;
  customizationId?: string;
  schemaVersion?: string;
  namespace?: string;
}

/**
 * Extract root element info from XML
 */
function extractRootInfo(xml: string): RootInfo {
  // Skip XML declaration
  let startIndex = 0;
  const declarationMatch = xml.match(/^<\?xml[^?]*\?>\s*/);
  if (declarationMatch) {
    startIndex = declarationMatch[0].length;
  }

  // Skip DOCTYPE if present
  const doctypeMatch = xml.slice(startIndex).match(/^<!DOCTYPE[^>]*>\s*/);
  if (doctypeMatch) {
    startIndex += doctypeMatch[0].length;
  }

  // Find first element
  const elementMatch = xml.slice(startIndex).match(/<([a-zA-Z_][\w.-]*(?::[a-zA-Z_][\w.-]*)?)/);
  if (!elementMatch?.[1]) {
    throw new Error('No root element found');
  }

  const fullName = elementMatch[1];
  const parts = fullName.split(':');

  if (parts.length === 2 && parts[0] && parts[1]) {
    const result: RootInfo = {
      rootElement: fullName,
      localName: parts[1],
    };
    result.prefix = parts[0];
    return result;
  }

  return {
    rootElement: fullName,
    localName: fullName,
  };
}

/**
 * Extract namespace declarations from XML
 */
function extractNamespaces(xml: string): Map<string, string> {
  const namespaces = new Map<string, string>();

  // Match xmlns declarations
  const nsRegex = /xmlns(?::([a-zA-Z_][\w.-]*))?="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = nsRegex.exec(xml)) !== null) {
    const prefix = match[1] ?? ''; // Default namespace has empty prefix
    const uri = match[2] ?? '';
    namespaces.set(prefix, uri);
  }

  return namespaces;
}

/**
 * Detect document type from root element name
 */
function detectDocumentType(rootElement: string): DocumentType {
  const localName = rootElement.includes(':')
    ? (rootElement.split(':')[1] ?? rootElement)
    : rootElement;
  const lowerName = localName.toLowerCase();

  if (lowerName === 'invoice') {
    return 'Invoice';
  }
  if (lowerName === 'creditnote') {
    return 'CreditNote';
  }
  if (lowerName === 'crossindustryinvoice') {
    // CII can be Invoice or CreditNote - need to check inside
    return 'Invoice'; // Default to Invoice for CII
  }

  return 'Unknown';
}

/**
 * Detect format based on XML structure and content
 */
function detectFormat(
  xml: string,
  rootInfo: RootInfo,
  namespaces: Map<string, string>,
): FormatInfo {
  const lowerXml = xml.toLowerCase();
  const localName = rootInfo.localName.toLowerCase();

  // Check for UBL document types
  const isUbl = localName === 'invoice' || localName === 'creditnote';

  // Check for CII document type
  const isCii = localName === 'crossindustryinvoice';

  // Check namespaces
  let namespace: string | undefined;
  for (const [, uri] of namespaces) {
    if (uri.includes('oasis:names:specification:ubl')) {
      namespace = uri;
      break;
    }
    if (uri.includes('uncefact:data:standard:CrossIndustryInvoice')) {
      namespace = uri;
      break;
    }
  }

  // Extract CustomizationID and ProfileID for more accurate detection
  const customizationId = extractElement(xml, 'CustomizationID');
  const profileId = extractElement(xml, 'ProfileID');
  const guidelineId = extractElement(xml, 'GuidelineSpecifiedDocumentContextParameter');

  // Build combined profile string for pattern matching
  const combinedProfile = [customizationId, profileId, guidelineId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Helper to build FormatInfo with optional properties (exactOptionalPropertyTypes safe)
  const buildFormatInfo = (format: DetectedFormat): FormatInfo => {
    const info: FormatInfo = { format };
    if (namespace) info.namespace = namespace;
    return info;
  };

  // 1. Check for XRechnung
  if (isXRechnungProfile(combinedProfile, lowerXml)) {
    const info = buildFormatInfo('xrechnung');
    if (profileId) info.profile = profileId;
    if (customizationId) info.customizationId = customizationId;
    const schemaVersion = extractXRechnungVersion(combinedProfile);
    if (schemaVersion) info.schemaVersion = schemaVersion;
    return info;
  }

  // 2. Check for ZUGFeRD/Factur-X
  if (isZugferdProfile(combinedProfile, lowerXml)) {
    const info = buildFormatInfo('zugferd');
    const profile = extractZugferdProfile(combinedProfile, guidelineId ?? '');
    if (profile) info.profile = profile;
    if (customizationId) info.customizationId = customizationId;
    const schemaVersion = extractZugferdVersion(combinedProfile);
    if (schemaVersion) info.schemaVersion = schemaVersion;
    return info;
  }

  // 3. Check for Peppol-BIS
  if (isPeppolProfile(combinedProfile, lowerXml)) {
    const info = buildFormatInfo('peppol-bis');
    if (profileId) info.profile = profileId;
    if (customizationId) info.customizationId = customizationId;
    return info;
  }

  // 4. Generic UBL
  if (isUbl) {
    const info = buildFormatInfo('ubl');
    if (customizationId) info.customizationId = customizationId;
    if (profileId) info.profile = profileId;
    return info;
  }

  // 5. Generic CII
  if (isCii) {
    const info = buildFormatInfo('cii');
    const profile = guidelineId ?? profileId;
    if (profile) info.profile = profile;
    return info;
  }

  // 6. Unknown
  return buildFormatInfo('unknown');
}

/**
 * Extract element text content from XML (simple pattern matching)
 */
function extractElement(xml: string, elementName: string): string | null {
  // Try with namespace prefix
  const prefixPattern = new RegExp(
    `<[a-z]+:${elementName}[^>]*>([^<]+)<\\/[a-z]+:${elementName}>`,
    'i',
  );
  const prefixMatch = xml.match(prefixPattern);
  if (prefixMatch?.[1]) {
    return prefixMatch[1].trim();
  }

  // Try without namespace prefix
  const simplePattern = new RegExp(`<${elementName}[^>]*>([^<]+)<\\/${elementName}>`, 'i');
  const simpleMatch = xml.match(simplePattern);
  if (simpleMatch?.[1]) {
    return simpleMatch[1].trim();
  }

  // Try nested structure (CII style)
  const nestedPattern = new RegExp(
    `<[a-z]*:?${elementName}[^>]*>[\\s\\S]*?<[a-z]*:?ID[^>]*>([^<]+)<\\/[a-z]*:?ID>`,
    'i',
  );
  const nestedMatch = xml.match(nestedPattern);
  if (nestedMatch?.[1]) {
    return nestedMatch[1].trim();
  }

  return null;
}

/**
 * Check if profile matches XRechnung
 */
function isXRechnungProfile(profile: string, xml: string): boolean {
  return (
    FORMAT_PROFILES.XRECHNUNG.some((p) => profile.includes(p.toLowerCase())) ||
    xml.includes('xrechnung')
  );
}

/**
 * Check if profile matches ZUGFeRD/Factur-X
 */
function isZugferdProfile(profile: string, xml: string): boolean {
  return (
    FORMAT_PROFILES.ZUGFERD.some((p) => profile.includes(p.toLowerCase())) ||
    xml.includes('zugferd') ||
    xml.includes('factur-x')
  );
}

/**
 * Check if profile matches Peppol
 */
function isPeppolProfile(profile: string, xml: string): boolean {
  return (
    FORMAT_PROFILES.PEPPOL.some((p) => profile.includes(p.toLowerCase())) ||
    (xml.includes('peppol') && !xml.includes('xrechnung'))
  );
}

/**
 * Extract XRechnung version from profile
 */
function extractXRechnungVersion(profile: string): string | undefined {
  const versionMatch = profile.match(/xrechnung[_:]?(\d+(?:\.\d+)*)/i);
  return versionMatch?.[1];
}

/**
 * Extract ZUGFeRD version from profile
 */
function extractZugferdVersion(profile: string): string | undefined {
  const versionMatch = profile.match(/(?:zugferd|factur-x)[_:]?(\d+(?:p\d+)?|\d+(?:\.\d+)*)/i);
  return versionMatch?.[1];
}

/**
 * Extract ZUGFeRD profile level (MINIMUM, BASIC, COMFORT, EXTENDED)
 */
function extractZugferdProfile(profile: string, guidelineId: string): string {
  const lowerProfile = (profile + ' ' + guidelineId).toLowerCase();

  if (lowerProfile.includes('extended')) {
    return 'EXTENDED';
  }
  if (lowerProfile.includes('xrechnung')) {
    return 'XRECHNUNG';
  }
  if (lowerProfile.includes('en16931') || lowerProfile.includes('comfort')) {
    return 'EN16931';
  }
  if (lowerProfile.includes('basic-wl') || lowerProfile.includes('basicwl')) {
    return 'BASIC-WL';
  }
  if (lowerProfile.includes('basic')) {
    return 'BASIC';
  }
  if (lowerProfile.includes('minimum')) {
    return 'MINIMUM';
  }

  return 'UNKNOWN';
}
