export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ExtensionRecord = Record<string, JsonValue>;

export type Sha256Hash = `sha256:${string}`;

export interface RulesetRef {
  id: string;
  edition: string;
  rulesVersion: string;
  engineApiVersion: string;
  extensions?: ExtensionRecord;
}

export type ContentOrigin = 'bundled' | 'user-authored' | 'user-imported' | 'external-import';
export type RightsBasis =
  | 'licensed'
  | 'open-license'
  | 'public-domain'
  | 'user-authored'
  | 'metadata-only'
  | 'unknown';
export type RightsReviewStatus = 'unreviewed' | 'pending' | 'approved' | 'rejected' | 'expired';
export type RightsDistribution = 'bundled' | 'private-import' | 'metadata-only' | 'prohibited';
export type RightsSharing = 'none' | 'references-only' | 'full';
export type ContentClass = 'mechanics' | 'facts' | 'prose' | 'tables' | 'art';

export interface PackDependency {
  id: string;
  versionRange: string;
  optional?: boolean;
  reason?: string;
  extensions?: ExtensionRecord;
}

export interface PackConflict {
  id: string;
  versionRange?: string;
  reason?: string;
  extensions?: ExtensionRecord;
}

export interface ContentRightsDeclaration {
  basis: RightsBasis;
  reviewStatus: RightsReviewStatus;
  distribution: RightsDistribution;
  sharing: RightsSharing;
  contentClasses: ContentClass[];
  rightsHolder?: string;
  licenseId?: string;
  licenseUrl?: string;
  permissionRef?: string;
  attribution?: string;
  reviewedAt?: string;
  extensions?: ExtensionRecord;
}

export interface ContentPackMetadataV1 {
  $schema: 'grimcomp.content-metadata.v1';
  id: string;
  name: string;
  version: string;
  rulesetRef: RulesetRef;
  origin: ContentOrigin;
  dependencies: PackDependency[];
  conflicts: PackConflict[];
  rights: ContentRightsDeclaration;
  extensions?: ExtensionRecord;
}

export type MissingPackPolicy = 'block' | 'warn';

export interface SourcePackSelection {
  id: string;
  versionRange: string;
  enabled: boolean;
  order: number;
  required?: boolean;
  pinnedVersion?: string;
  pinnedHash?: Sha256Hash;
  extensions?: ExtensionRecord;
}

export interface SourceProfilePolicy {
  missingPack: MissingPackPolicy;
  allowHomebrew: boolean;
  allowedRightsStatuses: RightsReviewStatus[];
  extensions?: ExtensionRecord;
}

export interface SourceProfileV1 {
  $schema: 'grimcomp.source-profile.v1';
  id: string;
  name: string;
  rulesetRef: RulesetRef;
  packs: SourcePackSelection[];
  policy: SourceProfilePolicy;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
  extensions?: ExtensionRecord;
}

export interface PackLockEntry {
  id: string;
  version: string;
  hash: Sha256Hash;
  extensions?: ExtensionRecord;
}

export type RuleOptionValue = string | number | boolean;

export interface CampaignProfileV1 {
  $schema: 'grimcomp.campaign-profile.v1';
  id: string;
  name: string;
  rulesetRef: RulesetRef;
  sourceProfileId: string;
  pinnedResolutionHash: Sha256Hash;
  packLock: PackLockEntry[];
  houseRulePackIds: string[];
  ruleOptions: Record<string, RuleOptionValue>;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
  extensions?: ExtensionRecord;
}

export interface DefinitionRef {
  id: string;
  name?: string;
  packId?: string;
  specialization?: string;
  extensions?: ExtensionRecord;
}

interface ProfileBindingBase {
  resolutionHash: Sha256Hash;
  packLock?: PackLockEntry[];
  extensions?: ExtensionRecord;
}

export interface SourceProfileBinding extends ProfileBindingBase {
  kind: 'source';
  sourceProfileId: string;
}

export interface CampaignProfileBinding extends ProfileBindingBase {
  kind: 'campaign';
  campaignProfileId: string;
}

export interface DetachedProfileBinding extends ProfileBindingBase {
  kind: 'detached';
}

export type CharacterProfileBinding =
  | SourceProfileBinding
  | CampaignProfileBinding
  | DetachedProfileBinding;

export interface CharacterIdentity {
  name: string;
  playerName?: string;
  speciesRef?: DefinitionRef;
  careerRef?: DefinitionRef;
  speciesName?: string;
  className?: string;
  age?: number;
  height?: string;
  hair?: string;
  eyes?: string;
  accent?: string;
  extensions?: ExtensionRecord;
}

export interface ExperienceEntry {
  dateLabel?: string;
  occurredAt?: string;
  reason: string;
  delta: number;
  kind: string;
  entityKey?: string;
  extensions?: ExtensionRecord;
}

export interface ExperienceLedger {
  earned: number;
  spent: number;
  entries: ExperienceEntry[];
  extensions?: ExtensionRecord;
}

export interface CareerHistorySnapshot {
  careerRef?: DefinitionRef;
  careerName: string;
  className?: string;
  level: number;
  levelName: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  extensions?: ExtensionRecord;
}

export interface CharacterAdvance {
  kind: string;
  entityKey?: string;
  amount: number;
  cost?: number;
  dateLabel?: string;
  occurredAt?: string;
  reason?: string;
  extensions?: ExtensionRecord;
}

export interface CharacterProgression {
  experience: ExperienceLedger;
  careerHistory: CareerHistorySnapshot[];
  advances: CharacterAdvance[];
  extensions?: ExtensionRecord;
}

export interface CharacteristicStat {
  label: string;
  short: string;
  base: number;
  advances: number;
  temporary?: number;
  override?: number;
  source?: string;
  extensions?: ExtensionRecord;
}

export interface SkillStat {
  definitionRef?: DefinitionRef;
  name: string;
  characteristicKey: string;
  advances: number;
  career: boolean;
  advanced: boolean;
  grouped?: string;
  specialization?: string;
  source?: string;
  extensions?: ExtensionRecord;
}

export interface CharacterStats {
  characteristics: Record<string, CharacteristicStat>;
  skills: Record<string, SkillStat>;
  extensions?: ExtensionRecord;
}

export interface CharacterResourceValue {
  current: number;
  maxOverride?: number;
  source?: string;
  extensions?: ExtensionRecord;
}

export interface NamedAbility {
  definitionRef?: DefinitionRef;
  name: string;
  source?: string;
  extensions?: ExtensionRecord;
}

export interface TalentAbility extends NamedAbility {
  rank: number;
  specialization?: string;
}

export interface CharacterAbilities {
  talents: TalentAbility[];
  spells: NamedAbility[];
  prayers: NamedAbility[];
  traits: NamedAbility[];
  extensions?: ExtensionRecord;
}

export interface InventoryItem {
  id: string;
  name: string;
  definitionRef?: DefinitionRef;
  quantity: number;
  equipped?: boolean;
  state?: ExtensionRecord;
  extensions?: ExtensionRecord;
}

export interface CharacterCondition {
  definitionRef?: DefinitionRef;
  name: string;
  stacks: number;
  extensions?: ExtensionRecord;
}

export interface CharacterCritical {
  definitionRef?: DefinitionRef;
  name: string;
  loc: string;
  roll: number;
  effect: string;
  days: number;
  extensions?: ExtensionRecord;
}

export interface CharacterMutation {
  definitionRef?: DefinitionRef;
  name: string;
  extensions?: ExtensionRecord;
}

export interface CharacterState {
  conditions: CharacterCondition[];
  criticals: CharacterCritical[];
  mutations: CharacterMutation[];
  psychology: string[];
  equipmentState: ExtensionRecord;
  extensions?: ExtensionRecord;
}

export interface CharacterNarrative {
  ambitionsShort?: string;
  ambitionsLong?: string;
  motivation?: string;
  biography?: string;
  extensions?: ExtensionRecord;
}

export interface CharacterNote {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  extensions?: ExtensionRecord;
}

export interface CharacterOrigin {
  kind: 'created' | 'template' | 'imported';
  sourceId?: string;
  importerId?: string;
  importedAt?: string;
  platform?: string;
  adapterVersion?: string;
  timestampsInferred?: boolean;
  sourceHash?: Sha256Hash;
  extensions?: ExtensionRecord;
}

export interface UnresolvedRef {
  code: string;
  path: string;
  reason: string;
  legacyKey?: string;
  rawHash?: Sha256Hash;
  ref?: DefinitionRef;
  extensions?: ExtensionRecord;
}

export interface CharacterDocumentV2 {
  $schema: 'grimcomp.character.v2';
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  rulesetRef: RulesetRef;
  profileBinding: CharacterProfileBinding;
  identity: CharacterIdentity;
  progression: CharacterProgression;
  stats: CharacterStats;
  resources: Record<string, CharacterResourceValue>;
  abilities: CharacterAbilities;
  inventory: InventoryItem[];
  state: CharacterState;
  narrative: CharacterNarrative;
  notes: CharacterNote[];
  userContent: ExtensionRecord;
  origin: CharacterOrigin;
  unresolvedRefs: UnresolvedRef[];
  legacyExtensions?: ExtensionRecord;
  extensions?: ExtensionRecord;
}

export interface ExchangeProducer {
  id: string;
  version: string;
  extensions?: ExtensionRecord;
}

export interface ExchangeEnvelopeV1 {
  $schema: 'grimcomp.exchange.v1';
  producer: ExchangeProducer;
  producedAt: string;
  characters: CharacterDocumentV2[];
  sourceProfiles: SourceProfileV1[];
  campaignProfiles: CampaignProfileV1[];
  contentPackMetadata: ContentPackMetadataV1[];
  extensions?: ExtensionRecord;
}
