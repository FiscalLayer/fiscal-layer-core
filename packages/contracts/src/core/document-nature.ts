/**
 * Document Nature and Evidence Level Types
 *
 * These types classify invoice documents by their nature and regulatory evidence strength.
 * Used to determine processing paths and risk assessment strategies.
 *
 * @packageDocumentation
 */

/**
 * Document Nature - Classification of invoice document types
 *
 * @description
 * Determines the processing path and risk assessment approach:
 *
 * - 'en16931': Structured electronic invoice (XRechnung, ZUGFeRD, Peppol-BIS, UBL, CII)
 *   - Full machine-readable structure
 *   - Highest regulatory compliance
 *   - Can achieve APPROVED status
 *
 * - 'pdf-text': PDF with extractable text
 *   - Non-structured but machine-readable
 *   - Partial field extraction via heuristics
 *   - Maximum status: APPROVED_WITH_WARNINGS
 *
 * - 'pdf-scanned': Scanned PDF (image-based)
 *   - Requires OCR for text extraction
 *   - Lowest evidence level
 *   - Maximum status: APPROVED_WITH_WARNINGS
 */
export type DocumentNature = 'en16931' | 'pdf-text' | 'pdf-scanned';

/**
 * Evidence Level - Regulatory compliance weight of the document
 *
 * @description
 * Represents the strength of the document as compliance evidence during tax audits.
 *
 * - 'E3': Highest level - Structured e-invoice (EN16931 compliant)
 *   - Full regulatory acceptance
 *   - Machine-verifiable integrity
 *
 * - 'E2': Medium level - PDF with extractable text
 *   - May require original document during audit
 *   - Cannot verify tampering
 *
 * - 'E1': Lowest level - Scanned document
 *   - Authenticity may be questioned
 *   - Requires original document retention
 */
export type EvidenceLevel = 'E1' | 'E2' | 'E3';

/**
 * Document Nature Detection Result
 */
export interface DocumentNatureResult {
  /** Detected document nature */
  nature: DocumentNature;

  /** Corresponding evidence level */
  evidenceLevel: EvidenceLevel;

  /**
   * Classification confidence score (0-1)
   *
   * For PDF documents, indicates how confident the system is
   * about the pdf-text vs pdf-scanned classification.
   *
   * Note: This is NOT extraction confidence - that's tracked separately.
   */
  classificationConfidence?: number;

  /** Detection evidence */
  evidence: DocumentNatureEvidence;
}

/**
 * Evidence supporting document nature classification
 */
export interface DocumentNatureEvidence {
  /** Whether the content is PDF format */
  isPdf: boolean;

  /** Number of extractable text characters */
  extractableTextLength?: number;

  /** Whether text density threshold was met */
  meetsTextThreshold?: boolean;

  /** Document page count */
  pageCount?: number;

  /** Whether document is primarily image-based */
  isImageBased?: boolean;

  /** Text extraction failed (timeout/error) */
  textExtractionFailed?: boolean;

  /** Error message if extraction failed */
  textExtractionError?: string;
}

/**
 * Evidence Level mapping from Document Nature
 */
export const EVIDENCE_LEVEL_MAP: Record<DocumentNature, EvidenceLevel> = {
  en16931: 'E3',
  'pdf-text': 'E2',
  'pdf-scanned': 'E1',
};

/**
 * Evidence Level descriptions for UI and diagnostics
 */
export const EVIDENCE_LEVEL_DESCRIPTIONS: Record<
  EvidenceLevel,
  {
    /** Short label */
    label: string;
    /** Detailed description */
    description: string;
    /** Audit risk explanation */
    auditRisk: string;
    /** Localized labels */
    i18n: {
      de: { label: string; description: string; auditRisk: string };
      en: { label: string; description: string; auditRisk: string };
    };
  }
> = {
  E3: {
    label: 'Structured E-Invoice',
    description: 'EN16931 compliant electronic invoice with full machine-readable structure',
    auditRisk: 'Low - meets regulatory requirements for e-invoicing',
    i18n: {
      de: {
        label: 'Strukturierte E-Rechnung',
        description: 'EN16931-konforme elektronische Rechnung mit vollständiger maschinenlesbarer Struktur',
        auditRisk: 'Niedrig - erfüllt regulatorische Anforderungen für E-Rechnungen',
      },
      en: {
        label: 'Structured E-Invoice',
        description: 'EN16931 compliant electronic invoice with full machine-readable structure',
        auditRisk: 'Low - meets regulatory requirements for e-invoicing',
      },
    },
  },
  E2: {
    label: 'PDF with Extractable Text',
    description: 'PDF document with selectable text, partial field extraction possible',
    auditRisk: 'Medium - may require manual verification during tax audit',
    i18n: {
      de: {
        label: 'PDF mit extrahierbarem Text',
        description: 'PDF-Dokument mit auswählbarem Text, teilweise Feldextraktion möglich',
        auditRisk: 'Mittel - manuelle Überprüfung bei Steuerprüfung möglicherweise erforderlich',
      },
      en: {
        label: 'PDF with Extractable Text',
        description: 'PDF document with selectable text, partial field extraction possible',
        auditRisk: 'Medium - may require manual verification during tax audit',
      },
    },
  },
  E1: {
    label: 'Scanned Document',
    description: 'Scanned PDF requiring automated extraction, confidence may vary',
    auditRisk: 'High - authenticity may be questioned during tax audit',
    i18n: {
      de: {
        label: 'Gescanntes Dokument',
        description: 'Gescanntes PDF erfordert automatisierte Extraktion, Konfidenz kann variieren',
        auditRisk: 'Hoch - Authentizität kann bei Steuerprüfung angezweifelt werden',
      },
      en: {
        label: 'Scanned Document',
        description: 'Scanned PDF requiring automated extraction, confidence may vary',
        auditRisk: 'High - authenticity may be questioned during tax audit',
      },
    },
  },
};

/**
 * Maximum allowed validation status per evidence level.
 *
 * @deprecated **MUST migrate** to @fiscal-layer/decision-engine (private).
 * **Will throw at runtime when accessed.** See docs/open-core.md for migration guide.
 *
 * OSS Boundary: This constant encodes DECISION LOGIC which belongs in the Private layer.
 * OSS should report evidence level as a fact; the Private decision layer
 * determines what statuses are achievable based on policy configuration.
 *
 * Migration: Import from @fiscal-layer/decision-engine (Private)
 * or implement your own evidence-to-status mapping in your decision layer.
 *
 * @throws {Error} Throws when any property is accessed - CI should block any usage of this constant
 */
export const MAX_STATUS_BY_EVIDENCE_LEVEL: Record<EvidenceLevel, 'APPROVED' | 'APPROVED_WITH_WARNINGS'> =
  new Proxy({} as Record<EvidenceLevel, 'APPROVED' | 'APPROVED_WITH_WARNINGS'>, {
    get(): never {
      throw new Error(
        '[OSS BOUNDARY] MAX_STATUS_BY_EVIDENCE_LEVEL has been moved to @fiscal-layer/decision-engine. ' +
          'Evidence level capping is policy logic, not validation fact.',
      );
    },
  });
