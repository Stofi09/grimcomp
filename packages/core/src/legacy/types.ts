import type { DecodeFailure, Diagnostic } from '../diagnostics';
import type {
  CampaignProfileV1,
  CharacterDocumentV2,
  CharacterOrigin,
  CharacterProfileBinding,
  ContentPackMetadataV1,
  DefinitionRef,
  ExchangeEnvelopeV1,
  ExchangeProducer,
  ExtensionRecord,
  RulesetRef,
  Sha256Hash,
  SourceProfileV1,
} from '../types';

/** The legacy payload is deliberately untyped until the defensive decoder has run. */
export interface LegacyCharacterSourceV1 {
  readonly character: unknown;
  /** Character-scoped suffixes such as `xp`, `chars.adv`, and `magic.spellbook`. */
  readonly overlays: Readonly<Record<string, unknown>>;
  /** Built-in templates supplied their XP seed outside the Character object. */
  readonly xpLogSeed?: unknown;
}

export type LegacyReferenceKind =
  | 'species'
  | 'career'
  | 'skill'
  | 'talent'
  | 'spell'
  | 'prayer'
  | 'weapon'
  | 'armour'
  | 'trapping'
  | 'condition'
  | 'critical'
  | 'mutation';

/**
 * An explicit, caller-owned alias table. The adapter never searches content,
 * slugifies labels, or invents pack identities.
 */
export interface LegacyReferenceResolution {
  readonly kind: LegacyReferenceKind;
  readonly legacyId?: string;
  readonly legacyName?: string;
  readonly specialization?: string;
  readonly ref: DefinitionRef;
  readonly displayName?: string;
}

export interface LegacyCharacterAdapterContext {
  readonly revision?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly importedAt: string;
  readonly rulesetRef: RulesetRef;
  readonly profileBinding: CharacterProfileBinding;
  readonly platform: string;
  readonly sourceId: string;
  readonly sourceHash?: Sha256Hash;
  readonly originKind?: CharacterOrigin['kind'];
  readonly resolutions?: readonly LegacyReferenceResolution[];
}

export interface LegacyRosterEntry {
  readonly source: LegacyCharacterSourceV1;
  readonly context: LegacyCharacterAdapterContext;
}

export interface LegacyEnvelopeContext {
  readonly producer: ExchangeProducer;
  readonly producedAt: string;
  readonly sourceProfiles: readonly SourceProfileV1[];
  readonly campaignProfiles: readonly CampaignProfileV1[];
  readonly contentPackMetadata: readonly ContentPackMetadataV1[];
  readonly extensions?: ExtensionRecord;
}

export interface LegacyAdapterSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly Diagnostic[];
}

export type LegacyAdapterResult<T> = LegacyAdapterSuccess<T> | DecodeFailure;

export type LegacyCharacterAdapterResult = LegacyAdapterResult<CharacterDocumentV2>;
export type LegacyRosterAdapterResult = LegacyAdapterResult<ExchangeEnvelopeV1>;
