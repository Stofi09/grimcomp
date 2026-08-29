import { describe, expect, it } from 'vitest';
import {
  decodeCampaignProfileV1,
  decodeCharacterDocumentV2,
  decodeContentPackMetadataV1,
  decodeExchangeEnvelopeV1,
  decodeRulesetRef,
  decodeSourceProfileV1,
  formatDiagnosticPath,
  quoteDiagnosticValue,
  type DecodeResult,
} from '@grimcomp/core';

const CREATED_AT = '2026-08-29T10:00:00Z';
const UPDATED_AT = '2026-08-29T11:00:00+00:00';
const CORE_HASH = `sha256:${'a'.repeat(64)}`;
const SOURCE_RESOLUTION_HASH = `sha256:${'b'.repeat(64)}`;
const CAMPAIGN_RESOLUTION_HASH = `sha256:${'c'.repeat(64)}`;
const PORTABLE_RESOLUTION_HASH = `sha256:${'d'.repeat(64)}`;
const LEGACY_ENTRY_HASH = `sha256:${'e'.repeat(64)}`;
const LEGACY_SOURCE_HASH = `sha256:${'f'.repeat(64)}`;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function extensionChain(edges: number): Record<string, unknown> {
  const root = Object.create(null) as Record<string, unknown>;
  let cursor = root;
  for (let depth = 0; depth < edges; depth += 1) {
    const next = Object.create(null) as Record<string, unknown>;
    cursor.next = next;
    cursor = next;
  }
  return root;
}

function success<T>(result: DecodeResult<T>): T {
  expect(result.ok, result.diagnostics.map(diagnostic => diagnostic.message).join('\n')).toBe(true);
  if (!result.ok) throw new Error('Expected decode success.');
  return result.value;
}

function failureCodes<T>(result: DecodeResult<T>): string[] {
  expect(result.ok).toBe(false);
  return result.diagnostics.map(diagnostic => diagnostic.code);
}

function ruleset(edition = '4e') {
  return {
    id: 'wfrp',
    edition,
    rulesVersion: '4.0.0',
    engineApiVersion: '1',
  };
}

function contentMetadata(id = 'core.rules') {
  return {
    $schema: 'grimcomp.content-metadata.v1',
    id,
    name: 'Core rules metadata',
    version: '1.0.0',
    rulesetRef: ruleset(),
    origin: 'user-authored',
    dependencies: [] as Array<{
      id: string;
      versionRange: string;
      optional?: boolean;
      reason?: string;
    }>,
    conflicts: [] as Array<{
      id: string;
      versionRange?: string;
      reason?: string;
    }>,
    rights: {
      basis: 'user-authored',
      reviewStatus: 'approved',
      distribution: 'private-import',
      sharing: 'none',
      contentClasses: ['mechanics'],
      reviewedAt: CREATED_AT,
    },
  };
}

function sourceProfile(id = 'source.core', rulesetRef = ruleset()) {
  return {
    $schema: 'grimcomp.source-profile.v1',
    id,
    name: 'Core source profile',
    rulesetRef,
    packs: [{
      id: 'core.rules',
      versionRange: '^1.0.0',
      enabled: true,
      order: 0,
      pinnedVersion: '1.0.0',
      pinnedHash: CORE_HASH,
    }],
    policy: {
      missingPack: 'block',
      allowHomebrew: true,
      allowedRightsStatuses: ['approved', 'pending'],
    },
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function campaignProfile(id = 'campaign.one', rulesetRef = ruleset()) {
  return {
    $schema: 'grimcomp.campaign-profile.v1',
    id,
    name: 'The Enemy Within',
    rulesetRef,
    sourceProfileId: 'source.core',
    pinnedResolutionHash: CAMPAIGN_RESOLUTION_HASH,
    packLock: [{ id: 'core.rules', version: '1.0.0', hash: CORE_HASH }],
    houseRulePackIds: [],
    ruleOptions: { advantageCap: 10, criticalDeflection: true },
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function sourceBinding() {
  return {
    kind: 'source',
    sourceProfileId: 'source.core',
    resolutionHash: SOURCE_RESOLUTION_HASH,
    packLock: [{ id: 'core.rules', version: '1.0.0', hash: CORE_HASH }],
  };
}

function character(profileBinding: object = sourceBinding(), rulesetRef = ruleset()) {
  return {
    $schema: 'grimcomp.character.v2',
    id: 'character.one',
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    rulesetRef,
    profileBinding,
    identity: {
      name: 'Elsa',
      playerName: 'Player',
      speciesRef: { id: 'human', packId: 'core.rules' },
      careerRef: { id: 'lawyer', packId: 'core.rules' },
      speciesName: 'Human',
      className: 'Burgher',
      age: 31,
      height: `5' 7"`,
      hair: 'Brown',
      eyes: 'Grey',
      accent: 'Reiklander',
    },
    progression: {
      experience: {
        earned: 150,
        spent: 100,
        entries: [{
          dateLabel: '4.12.2522',
          occurredAt: CREATED_AT,
          reason: 'First session',
          delta: 150,
          kind: 'award',
          entityKey: 'session.1',
        }],
      },
      careerHistory: [{
        careerRef: { id: 'lawyer', packId: 'core.rules' },
        careerName: 'Lawyer',
        className: 'Burgher',
        level: 1,
        levelName: 'Student',
        status: 'current',
        startedAt: CREATED_AT,
      }],
      advances: [{
        kind: 'characteristic',
        entityKey: 'ws',
        amount: 5,
        cost: 100,
        dateLabel: 'Backertag after Hexensnacht',
        occurredAt: UPDATED_AT,
        reason: 'Training',
      }],
    },
    stats: {
      characteristics: {
        ws: { label: 'Weapon Skill', short: 'WS', base: 30, advances: 5, source: 'core.rules' },
        wp: { label: 'Willpower', short: 'WP', base: 35, advances: 0, source: 'core.rules' },
      },
      skills: {
        cool: {
          definitionRef: { id: 'cool', packId: 'core.rules' },
          name: 'Cool',
          characteristicKey: 'wp',
          advances: 3,
          career: true,
          advanced: false,
          grouped: 'Willpower',
          source: 'core.rules',
        },
      },
    },
    resources: {
      wounds: { current: 11, maxOverride: 12, source: 'core.rules' },
    },
    abilities: {
      talents: [{
        definitionRef: { id: 'savvy', packId: 'core.rules' },
        name: 'Savvy',
        rank: 1,
        specialization: 'Urban',
      }],
      spells: [{ name: 'Dart', definitionRef: { id: 'dart', packId: 'core.rules' } }],
      prayers: [],
      traits: [{ name: 'Night Vision' }],
    },
    inventory: [{
      id: 'item.sword',
      name: 'Sword',
      quantity: 1,
      equipped: true,
      state: { quality: 'durable' },
    }],
    state: {
      conditions: [{ name: 'Fatigued', stacks: 1 }],
      criticals: [{
        name: 'Gashed Arm',
        loc: '',
        roll: 42,
        effect: 'Bleeding',
        days: 3,
      }],
      mutations: [{ name: 'Unusual Eyes' }],
      psychology: ['Animosity (Beastmen)'],
      equipmentState: { encumbrance: 2 },
    },
    narrative: {
      ambitionsShort: 'Win a case',
      biography: 'A hard-bitten advocate.',
    },
    notes: [{
      id: 'note.one',
      body: 'Owes a favour.',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    }],
    userContent: { customPortrait: 'portrait-1' },
    origin: {
      kind: 'imported',
      sourceId: 'legacy.roster',
      importerId: 'grimcomp.legacy-adapter',
      importedAt: CREATED_AT,
      platform: 'grimcomp-web-v1',
      adapterVersion: '1.0.0',
      timestampsInferred: true,
      sourceHash: LEGACY_SOURCE_HASH,
    },
    unresolvedRefs: [{
      code: 'legacy-name-only',
      path: '$.abilities.talents[9]',
      reason: 'No stable ID was available.',
      legacyKey: 'Very Strong',
      rawHash: LEGACY_ENTRY_HASH,
    }],
    legacyExtensions: { importedTimes: { Savvy: 1 } },
  };
}

function envelope() {
  return {
    $schema: 'grimcomp.exchange.v1',
    producer: { id: 'grimcomp.web', version: '0.1.0' },
    producedAt: UPDATED_AT,
    characters: [character()],
    sourceProfiles: [sourceProfile()],
    campaignProfiles: [campaignProfile()],
    contentPackMetadata: [contentMetadata()],
  };
}

function unpinnedSourceSelection(id: string, order: number) {
  const selection = clone(sourceProfile().packs[0]);
  selection.id = id;
  selection.versionRange = '*';
  selection.order = order;
  delete selection.pinnedVersion;
  delete selection.pinnedHash;
  return selection;
}

function sourceResolutionEnvelope() {
  const candidate = envelope();
  candidate.characters = [];
  candidate.campaignProfiles = [];
  candidate.sourceProfiles[0].packs = [];
  candidate.contentPackMetadata = [];
  return candidate;
}

function ambiguityBoundaryEnvelope(packCount: number) {
  const candidate = sourceResolutionEnvelope();
  const ids = Array.from({ length: packCount }, (_, index) => `limit.pack.${index}`);
  ids.forEach((id, index) => {
    candidate.sourceProfiles[0].packs.push(unpinnedSourceSelection(id, index));
    const versionOne = contentMetadata(id);
    const versionTwo = contentMetadata(id);
    versionTwo.version = '2.0.0';
    versionOne.dependencies.push({
      id: ids[(index + 1) % ids.length],
      versionRange: '*',
    });
    candidate.contentPackMetadata.push(versionOne, versionTwo);
  });
  return candidate;
}

function graphColoringEnvelope(packCount: number, colorCount: number) {
  const candidate = sourceResolutionEnvelope();
  const ids = Array.from({ length: packCount }, (_, index) => `color.pack.${index}`);
  ids.forEach((id, order) => {
    candidate.sourceProfiles[0].packs.push(unpinnedSourceSelection(id, order));
    for (let color = 0; color < colorCount; color += 1) {
      const metadata = contentMetadata(id);
      metadata.version = `1.0.${color}`;
      metadata.conflicts = ids
        .filter(targetId => targetId !== id)
        .map(targetId => ({ id: targetId, versionRange: metadata.version }));
      candidate.contentPackMetadata.push(metadata);
    }
  });
  return candidate;
}

describe('diagnostics and ruleset identity', () => {
  it('formats paths for actionable diagnostics', () => {
    expect(formatDiagnosticPath(['characters', 0, 'id'])).toBe('$.characters[0].id');
    expect(formatDiagnosticPath(['stats', 'skill.with.dot', 'quote"key'])).toBe(
      '$.stats["skill.with.dot"]["quote\\"key"]',
    );
    expect(formatDiagnosticPath(['x[0]', 'line\nbreak'])).toBe(
      '$["x[0]"]["line\\nbreak"]',
    );
  });

  it('bounds and escapes attacker-controlled diagnostic values', () => {
    const untrusted = `line\nbreak-${'x'.repeat(500)}`;
    const quoted = quoteDiagnosticValue(untrusted);
    expect(quoted).not.toContain('\n');
    expect(quoted).not.toContain(untrusted);
    expect(quoted.length).toBeLessThan(120);

    const candidate = ruleset() as Record<string, unknown>;
    candidate[untrusted] = true;
    const unknown = decodeRulesetRef(candidate).diagnostics.find(
      diagnostic => diagnostic.code === 'unknown_key',
    );
    expect(unknown?.message).not.toContain('\n');
    expect(unknown?.message).not.toContain(untrusted);
  });

  it('accepts generic, nonblank edition identifiers', () => {
    const value = success(decodeRulesetRef(ruleset('homebrew-2027')));
    expect(value.edition).toBe('homebrew-2027');
  });

  it('requires every ruleset identity coordinate, including for 5e', () => {
    const candidate = ruleset('5e') as Record<string, unknown>;
    delete candidate.engineApiVersion;
    expect(failureCodes(decodeRulesetRef(candidate))).toContain('missing_ruleset_identity');
  });

  it('rejects the pre-freeze version key migration shape', () => {
    expect(decodeRulesetRef({ id: 'wfrp', edition: '4e', version: '4.0.0' }).ok).toBe(false);
  });
});

describe('content metadata and rights boundaries', () => {
  it('decodes metadata-only V1 without implying a content payload schema', () => {
    const value = success(decodeContentPackMetadataV1(contentMetadata()));
    expect(value.$schema).toBe('grimcomp.content-metadata.v1');
    expect(value.rights.reviewStatus).toBe('approved');
    expect(value.rulesetRef.engineApiVersion).toBe('1');
  });

  it('rejects the old content.v3 schema and ruleset wire key', () => {
    const old = { ...contentMetadata(), $schema: 'grimcomp.content.v3', ruleset: ruleset() };
    delete (old as Record<string, unknown>).rulesetRef;
    expect(failureCodes(decodeContentPackMetadataV1(old))).toContain('wrong_schema');
  });

  it('separates rights review status from rights basis', () => {
    const candidate = clone(contentMetadata());
    candidate.rights.reviewStatus = 'licensed';
    expect(failureCodes(decodeContentPackMetadataV1(candidate))).toContain('invalid_enum');
  });

  it('rejects obsolete origin and rights literals', () => {
    const candidate = clone(contentMetadata());
    candidate.origin = 'user';
    candidate.rights.basis = 'restricted';
    expect(failureCodes(decodeContentPackMetadataV1(candidate))).toEqual(
      expect.arrayContaining(['invalid_enum', 'invalid_enum']),
    );
  });

  it('rejects duplicates in metadata sets and relationship IDs', () => {
    const candidate = contentMetadata();
    candidate.rights.contentClasses = ['mechanics', 'mechanics'];
    candidate.dependencies = [
      { id: 'other.rules', versionRange: '^1.0.0' },
      { id: 'other.rules', versionRange: '^2.0.0' },
    ];
    candidate.conflicts = [
      { id: 'blocked.rules' },
      { id: 'blocked.rules', versionRange: '^2.0.0' },
    ];
    const codes = failureCodes(decodeContentPackMetadataV1(candidate));
    expect(codes.filter(code => code === 'duplicate_id')).toHaveLength(2);
    expect(codes).toContain('duplicate_value');
  });
});

describe('source and campaign profiles', () => {
  it('decodes profiles with rulesetRef, status policy, locks, and revisions', () => {
    expect(success(decodeSourceProfileV1(sourceProfile())).revision).toBe(1);
    expect(success(decodeCampaignProfileV1(campaignProfile())).packLock[0].hash).toBe(CORE_HASH);
  });

  it('requires revisions to start at one', () => {
    const source = sourceProfile();
    const campaign = campaignProfile();
    source.revision = 0;
    campaign.revision = 0;
    expect(failureCodes(decodeSourceProfileV1(source))).toContain('invalid_integer');
    expect(failureCodes(decodeCampaignProfileV1(campaign))).toContain('invalid_integer');
  });

  it('rejects unsafe wire integers and accepts the largest safe integer', () => {
    const safe = sourceProfile();
    safe.revision = Number.MAX_SAFE_INTEGER;
    expect(decodeSourceProfileV1(safe).ok).toBe(true);

    const unsafe = sourceProfile();
    unsafe.revision = Number.MAX_SAFE_INTEGER + 1;
    unsafe.packs[0].order = Number.MAX_SAFE_INTEGER + 1;
    const codes = failureCodes(decodeSourceProfileV1(unsafe));
    expect(codes.filter(code => code === 'invalid_integer')).toHaveLength(2);
  });

  it('rejects blank campaign rule-option identifiers', () => {
    const candidate = campaignProfile();
    candidate.ruleOptions = { '   ': true };
    const result = decodeCampaignProfileV1(candidate);
    expect(failureCodes(result)).toContain('blank_id');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'blank_id',
      path: ['ruleOptions', '   '],
    }));
  });

  it('rejects duplicate allowed rights statuses', () => {
    const candidate = sourceProfile();
    candidate.policy.allowedRightsStatuses = ['approved', 'approved'];
    expect(failureCodes(decodeSourceProfileV1(candidate))).toContain('duplicate_value');
  });

  it('requires sha256-prefixed nonblank digests', () => {
    for (const hash of [
      '',
      'md5:' + 'a'.repeat(64),
      'sha256:',
      `sha256:${'a'.repeat(63)}`,
      `sha256:${'a'.repeat(65)}`,
      `sha256:${'A'.repeat(64)}`,
      `sha256:${'g'.repeat(64)}`,
      `SHA256:${'a'.repeat(64)}`,
      `sha256:${'a'.repeat(32)} ${'a'.repeat(31)}`,
    ]) {
      const candidate = campaignProfile();
      candidate.pinnedResolutionHash = hash;
      expect(failureCodes(decodeCampaignProfileV1(candidate))).toContain(
        hash === '' ? 'blank_string' : 'invalid_hash',
      );
    }
  });

  it('rejects invalid and reverse-ordered RFC3339 timestamps', () => {
    const invalid = sourceProfile();
    invalid.createdAt = '2026-08-29';
    expect(failureCodes(decodeSourceProfileV1(invalid))).toContain('invalid_timestamp');

    const reversed = campaignProfile();
    reversed.createdAt = UPDATED_AT;
    reversed.updatedAt = CREATED_AT;
    expect(failureCodes(decodeCampaignProfileV1(reversed))).toContain('timestamp_order');
  });

  it('rejects impossible RFC3339 calendar, clock, and offset components', () => {
    for (const timestamp of [
      '2026-02-29T10:00:00Z',
      '2024-02-30T10:00:00Z',
      '2026-04-31T10:00:00Z',
      '2026-08-29T24:00:00Z',
      '2026-08-29T23:60:00Z',
      '2026-08-29T23:59:60Z',
      '2026-08-29T10:00:00+24:00',
      '2026-08-29T10:00:00+02:60',
      '2026-08-29T10:00:00Z trailing',
    ]) {
      const candidate = sourceProfile();
      candidate.createdAt = timestamp;
      expect(failureCodes(decodeSourceProfileV1(candidate))).toContain('invalid_timestamp');
    }
  });

  it('accepts valid leap-day timestamps with a complete offset', () => {
    const candidate = sourceProfile();
    candidate.createdAt = '2024-02-29T23:59:59.123+14:00';
    candidate.updatedAt = candidate.createdAt;
    expect(decodeSourceProfileV1(candidate).ok).toBe(true);
  });

  it('orders RFC3339 fractions beyond millisecond precision', () => {
    const candidate = sourceProfile();
    candidate.createdAt = '2026-08-29T10:00:00.0009Z';
    candidate.updatedAt = '2026-08-29T10:00:00.0001Z';
    expect(failureCodes(decodeSourceProfileV1(candidate))).toContain('timestamp_order');
  });
});

describe('CharacterDocumentV2', () => {
  it('decodes the source-bound frozen shape and unresolved records without stable refs', () => {
    const value = success(decodeCharacterDocumentV2(character()));
    expect(value.profileBinding.kind).toBe('source');
    expect(value.progression.experience.entries[0].delta).toBe(150);
    expect(value.progression.experience.entries[0].dateLabel).toBe('4.12.2522');
    expect(value.progression.advances[0].occurredAt).toBe(UPDATED_AT);
    expect(value.unresolvedRefs[0].ref).toBeUndefined();
    expect(value.stats.skills.cool.characteristicKey).toBe('wp');
    expect(value.stats.skills.cool.grouped).toBe('Willpower');
    expect(value.identity).toMatchObject({
      speciesName: 'Human', className: 'Burgher', age: 31, height: `5' 7"`,
      hair: 'Brown', eyes: 'Grey', accent: 'Reiklander',
    });
    expect(value.origin).toMatchObject({
      platform: 'grimcomp-web-v1', adapterVersion: '1.0.0', timestampsInferred: true,
      sourceHash: LEGACY_SOURCE_HASH,
    });
  });

  it('preserves fantasy date labels without requiring a machine timestamp', () => {
    const candidate = character();
    const entry = candidate.progression.experience.entries[0] as unknown as Record<string, unknown>;
    delete entry.occurredAt;
    entry.dateLabel = '4.12.2522';
    const value = success(decodeCharacterDocumentV2(candidate));
    expect(value.progression.experience.entries[0]).toMatchObject({ dateLabel: '4.12.2522' });
    expect(value.progression.experience.entries[0].occurredAt).toBeUndefined();
  });

  it('validates dateLabel and occurredAt independently and rejects obsolete date', () => {
    const blankLabel = character();
    blankLabel.progression.experience.entries[0].dateLabel = '   ';
    expect(failureCodes(decodeCharacterDocumentV2(blankLabel))).toContain('blank_string');

    const badTimestamp = character();
    badTimestamp.progression.advances[0].occurredAt = '4.12.2522';
    expect(failureCodes(decodeCharacterDocumentV2(badTimestamp))).toContain('invalid_timestamp');

    const obsolete = character();
    (obsolete.progression.experience.entries[0] as unknown as Record<string, unknown>).date = CREATED_AT;
    expect(failureCodes(decodeCharacterDocumentV2(obsolete))).toContain('unknown_key');
  });

  it('requires grouped skill labels to be nonblank strings', () => {
    const blank = character();
    blank.stats.skills.cool.grouped = ' ';
    expect(failureCodes(decodeCharacterDocumentV2(blank))).toContain('blank_string');

    const boolean = character();
    (boolean.stats.skills.cool as unknown as Record<string, unknown>).grouped = true;
    expect(failureCodes(decodeCharacterDocumentV2(boolean))).toContain('invalid_type');
  });

  it('validates explicit legacy-adapter identity and origin fields', () => {
    const candidate = character();
    candidate.identity.age = Number.POSITIVE_INFINITY;
    (candidate.origin as unknown as Record<string, unknown>).timestampsInferred = 'yes';
    candidate.origin.sourceHash = `sha256:${'A'.repeat(64)}`;
    const codes = failureCodes(decodeCharacterDocumentV2(candidate));
    expect(codes).toEqual(expect.arrayContaining(['nonfinite_number', 'invalid_type', 'invalid_hash']));
  });

  it('supports campaign and detached binding variants', () => {
    const campaign = character({
      kind: 'campaign',
      campaignProfileId: 'campaign.one',
      resolutionHash: CAMPAIGN_RESOLUTION_HASH,
    });
    const detached = character({
      kind: 'detached',
      resolutionHash: PORTABLE_RESOLUTION_HASH,
    });
    expect(success(decodeCharacterDocumentV2(campaign)).profileBinding.kind).toBe('campaign');
    expect(success(decodeCharacterDocumentV2(detached)).profileBinding.kind).toBe('detached');
  });

  it('rejects missing, unknown, and contradictory binding discriminators', () => {
    const missing = character({ resolutionHash: SOURCE_RESOLUTION_HASH });
    const unknown = character({ kind: 'other', resolutionHash: SOURCE_RESOLUTION_HASH });
    const contradictory = character({
      kind: 'detached',
      sourceProfileId: 'source.core',
      resolutionHash: SOURCE_RESOLUTION_HASH,
    });
    expect(failureCodes(decodeCharacterDocumentV2(missing))).toContain('invalid_enum');
    expect(failureCodes(decodeCharacterDocumentV2(unknown))).toContain('invalid_enum');
    expect(failureCodes(decodeCharacterDocumentV2(contradictory))).toContain('missing_profile_binding');
  });

  it('requires revision and ordered RFC3339 document and note timestamps', () => {
    const candidate = character();
    candidate.revision = 0;
    candidate.createdAt = UPDATED_AT;
    candidate.updatedAt = CREATED_AT;
    candidate.notes[0].updatedAt = 'not-a-date';
    const codes = failureCodes(decodeCharacterDocumentV2(candidate));
    expect(codes).toEqual(expect.arrayContaining(['invalid_integer', 'timestamp_order', 'invalid_timestamp']));
  });

  it('rejects nonfinite values and malformed nested arrays', () => {
    const candidate = character();
    candidate.stats.characteristics.ws.base = Number.POSITIVE_INFINITY;
    (candidate.abilities as unknown as Record<string, unknown>).talents = {};
    const codes = failureCodes(decodeCharacterDocumentV2(candidate));
    expect(codes).toEqual(expect.arrayContaining(['nonfinite_number', 'invalid_type']));
  });

  it('rejects pre-freeze schemaVersion/profile and flat progression shapes', () => {
    const old = character() as unknown as Record<string, unknown>;
    old.schemaVersion = 2;
    old.profile = old.profileBinding;
    delete old.profileBinding;
    old.progression = { xpEarned: 100, xpSpent: 0, entries: [], careerHistory: [] };
    expect(decodeCharacterDocumentV2(old).ok).toBe(false);
  });
});

describe('decoder hardening and local invariants', () => {
  it('does not accept inherited prototype data as required wire fields', () => {
    const inheritedKey = 'engineApiVersion';
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, inheritedKey);
    try {
      Object.defineProperty(Object.prototype, inheritedKey, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: 'inherited-engine-api',
      });
      const candidate = ruleset() as Record<string, unknown>;
      delete candidate.engineApiVersion;
      expect(failureCodes(decodeRulesetRef(candidate))).toContain('missing_ruleset_identity');
    } finally {
      if (previous) Object.defineProperty(Object.prototype, inheritedKey, previous);
      else delete (Object.prototype as Record<string, unknown>)[inheritedKey];
    }
  });

  it('rejects enumerable getters without invoking them', () => {
    let getterCalls = 0;
    const candidate = ruleset() as Record<string, unknown>;
    Object.defineProperty(candidate, 'engineApiVersion', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('wire getters must never run');
      },
    });

    let result: ReturnType<typeof decodeRulesetRef> | undefined;
    expect(() => { result = decodeRulesetRef(candidate); }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.diagnostics).toContainEqual(expect.objectContaining({ code: 'unreadable_input' }));
    expect(getterCalls).toBe(0);
  });

  it('contains throwing proxy reflection traps and never relies on get traps', () => {
    const ownKeysProxy = new Proxy(ruleset(), {
      ownKeys() { throw new Error('ownKeys denied'); },
    });
    const prototypeProxy = new Proxy(ruleset(), {
      getPrototypeOf() { throw new Error('prototype denied'); },
    });
    let getCalls = 0;
    const getProxy = new Proxy(ruleset(), {
      get() {
        getCalls += 1;
        throw new Error('get denied');
      },
    });

    let ownKeysResult: ReturnType<typeof decodeRulesetRef> | undefined;
    let prototypeResult: ReturnType<typeof decodeRulesetRef> | undefined;
    let getResult: ReturnType<typeof decodeRulesetRef> | undefined;
    expect(() => { ownKeysResult = decodeRulesetRef(ownKeysProxy); }).not.toThrow();
    expect(() => { prototypeResult = decodeRulesetRef(prototypeProxy); }).not.toThrow();
    expect(() => { getResult = decodeRulesetRef(getProxy); }).not.toThrow();
    expect(ownKeysResult?.ok).toBe(false);
    expect(prototypeResult?.ok).toBe(false);
    expect(getResult?.ok).toBe(true);
    expect(getCalls).toBe(0);
  });

  it('caps proxy-synthesized own-key lists before descriptor traversal', () => {
    let descriptorCalls = 0;
    const keys = Array.from({ length: 10_001 }, (_, index) => `synthetic-${index}`);
    const candidate = new Proxy(ruleset(), {
      ownKeys() { return keys; },
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error('descriptors must not be traversed after the key cap');
      },
    });

    const result = decodeRulesetRef(candidate);
    expect(failureCodes(result)).toContain('decode_node_limit');
    expect(descriptorCalls).toBe(0);
  });

  it('fails closed on array and extension accessors without invoking them', () => {
    let arrayGetterCalls = 0;
    const exchange = envelope();
    Object.defineProperty(exchange.characters, '0', {
      configurable: true,
      enumerable: true,
      get() {
        arrayGetterCalls += 1;
        throw new Error('array getter must never run');
      },
    });
    expect(decodeExchangeEnvelopeV1(exchange).ok).toBe(false);
    expect(arrayGetterCalls).toBe(0);

    let extensionGetterCalls = 0;
    const metadata = contentMetadata() as Record<string, unknown>;
    const extension = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(extension, 'dangerous', {
      configurable: true,
      enumerable: true,
      get() {
        extensionGetterCalls += 1;
        throw new Error('extension getter must never run');
      },
    });
    metadata.extensions = extension;
    expect(decodeContentPackMetadataV1(metadata).ok).toBe(false);
    expect(extensionGetterCalls).toBe(0);
  });

  it('contains reflection failures in structural arrays and nested extensions', () => {
    const exchange = envelope();
    exchange.characters = new Proxy(exchange.characters, {
      ownKeys() { throw new Error('array ownKeys denied'); },
    });
    let exchangeResult: ReturnType<typeof decodeExchangeEnvelopeV1> | undefined;
    expect(() => { exchangeResult = decodeExchangeEnvelopeV1(exchange); }).not.toThrow();
    expect(exchangeResult?.ok).toBe(false);

    const metadata = contentMetadata() as Record<string, unknown>;
    metadata.extensions = new Proxy(Object.create(null) as Record<string, unknown>, {
      ownKeys() { throw new Error('extension ownKeys denied'); },
    });
    let metadataResult: ReturnType<typeof decodeContentPackMetadataV1> | undefined;
    expect(() => { metadataResult = decodeContentPackMetadataV1(metadata); }).not.toThrow();
    expect(metadataResult?.ok).toBe(false);
  });

  it('retains the 5,000-entry array boundary but caps hidden array decorations', () => {
    const boundary = character();
    boundary.state.psychology = new Array(5_000).fill('Fear');
    expect(decodeCharacterDocumentV2(boundary).ok).toBe(true);

    const decorated = contentMetadata();
    const classes: string[] = [];
    for (let index = 0; index < 10_001; index += 1) {
      Object.defineProperty(classes, `hidden-${index}`, {
        configurable: true,
        enumerable: false,
        value: index,
      });
    }
    decorated.rights.contentClasses = classes;
    expect(failureCodes(decodeContentPackMetadataV1(decorated))).toContain('decode_node_limit');
  });

  it('continues to accept ordinary parsed JSON data', () => {
    const parsed = JSON.parse(JSON.stringify(envelope())) as unknown;
    expect(decodeExchangeEnvelopeV1(parsed).ok).toBe(true);
  });

  it('rejects unknown keys in fixed objects with exact paths while extensions remain valid', () => {
    const candidate = character();
    (candidate.identity as unknown as Record<string, unknown>).speciesNmae = 'Human';
    (candidate.abilities.talents[0] as unknown as Record<string, unknown>).rnak = 2;
    const result = decodeCharacterDocumentV2(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown_key', path: ['identity', 'speciesNmae'] }),
      expect.objectContaining({ code: 'unknown_key', path: ['abilities', 'talents', 0, 'rnak'] }),
    ]));

    const extended = character();
    (extended.identity as unknown as Record<string, unknown>).extensions = { speciesNmae: 'Human' };
    const decoded = success(decodeCharacterDocumentV2(extended));
    expect(decoded.identity.extensions?.speciesNmae).toBe('Human');
    expect(decoded.abilities.talents[0].specialization).toBe('Urban');
  });

  it('rejects a missing skill characteristic target', () => {
    const candidate = character();
    delete (candidate.stats.characteristics as unknown as Record<string, unknown>).wp;
    const result = decodeCharacterDocumentV2(candidate);
    expect(failureCodes(result)).toContain('missing_reference');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      path: ['stats', 'skills', 'cool', 'characteristicKey'],
    }));
  });

  it('accepts blank critical locations and aligned numeric boundary values', () => {
    const candidate = character();
    candidate.inventory[0].quantity = 0.5;
    candidate.state.conditions[0].stacks = 0;
    candidate.state.criticals[0].loc = '';
    candidate.state.criticals[0].roll = 0;
    candidate.state.criticals[0].days = 0;
    expect(decodeCharacterDocumentV2(candidate).ok).toBe(true);
  });

  it('rejects numeric values outside the frozen invariants', () => {
    const candidate = character();
    candidate.progression.careerHistory[0].level = 0;
    candidate.abilities.talents[0].rank = 0;
    candidate.inventory[0].quantity = -0.5;
    candidate.state.conditions[0].stacks = 0.5;
    candidate.state.criticals[0].roll = -1;
    candidate.state.criticals[0].days = 1.5;
    const codes = failureCodes(decodeCharacterDocumentV2(candidate));
    expect(codes).toEqual(expect.arrayContaining(['out_of_range', 'invalid_integer']));
  });

  it('keeps critical loc type checking and rejects obsolete state woundsCurrent', () => {
    const candidate = character();
    (candidate.state.criticals[0] as unknown as Record<string, unknown>).loc = 0;
    (candidate.state as unknown as Record<string, unknown>).woundsCurrent = 11;
    const codes = failureCodes(decodeCharacterDocumentV2(candidate));
    expect(codes).toEqual(expect.arrayContaining(['invalid_type', 'unknown_key']));
  });

  it('rejects duplicate source pack IDs and precedence orders locally', () => {
    const duplicateId = sourceProfile();
    duplicateId.packs.push({ ...clone(duplicateId.packs[0]), order: 1 });
    expect(failureCodes(decodeSourceProfileV1(duplicateId))).toContain('duplicate_id');

    const duplicateOrder = sourceProfile();
    duplicateOrder.packs.push({ ...clone(duplicateOrder.packs[0]), id: 'other.rules' });
    expect(failureCodes(decodeSourceProfileV1(duplicateOrder))).toContain('duplicate_value');
  });

  it('rejects duplicate campaign and character-local stable IDs', () => {
    const campaign = campaignProfile();
    campaign.packLock.push(clone(campaign.packLock[0]));
    campaign.houseRulePackIds = ['house.rules', 'house.rules'];
    const campaignCodes = failureCodes(decodeCampaignProfileV1(campaign));
    expect(campaignCodes.filter(code => code === 'duplicate_id').length).toBeGreaterThanOrEqual(2);

    const sheet = character();
    sheet.inventory.push(clone(sheet.inventory[0]));
    sheet.notes.push(clone(sheet.notes[0]));
    const sheetCodes = failureCodes(decodeCharacterDocumentV2(sheet));
    expect(sheetCodes.filter(code => code === 'duplicate_id')).toHaveLength(2);
  });

  it('rejects duplicate IDs in optional character binding locks', () => {
    const binding = sourceBinding();
    binding.packLock.push(clone(binding.packLock[0]));
    expect(failureCodes(decodeCharacterDocumentV2(character(binding)))).toContain('duplicate_id');
  });

  it('accepts the exact extension depth limit and rejects the next level', () => {
    const atLimit = contentMetadata();
    (atLimit as unknown as Record<string, unknown>).extensions = extensionChain(63);
    expect(decodeContentPackMetadataV1(atLimit).ok).toBe(true);

    const beyondLimit = contentMetadata();
    (beyondLimit as unknown as Record<string, unknown>).extensions = extensionChain(64);
    expect(failureCodes(decodeContentPackMetadataV1(beyondLimit))).toContain(
      'extension_depth_exceeded',
    );
  });

  it('bounds wide extension objects with the shared decode-node budget', () => {
    const candidate = contentMetadata();
    const wide: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < 10_100; index += 1) wide['key-' + index] = index;
    (candidate as unknown as Record<string, unknown>).extensions = wide;
    expect(failureCodes(decodeContentPackMetadataV1(candidate))).toContain('decode_node_limit');
  });

  it('rejects cyclic extension data without throwing', () => {
    const candidate = contentMetadata();
    const cyclic: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    (candidate as unknown as Record<string, unknown>).extensions = cyclic;
    expect(failureCodes(decodeContentPackMetadataV1(candidate))).toContain('cyclic_extension');
  });

  it('caps pathological structural arrays before iterating them', () => {
    const candidate = envelope();
    candidate.characters = new Array(5_001).fill(candidate.characters[0]);
    expect(failureCodes(decodeExchangeEnvelopeV1(candidate))).toContain('array_too_large');
  });

  it('accepts the exact extension array limit and rejects one additional entry', () => {
    const atLimit = contentMetadata() as Record<string, unknown>;
    atLimit.extensions = { values: new Array(5_000).fill(0) };
    expect(decodeContentPackMetadataV1(atLimit).ok).toBe(true);

    const beyondLimit = contentMetadata() as Record<string, unknown>;
    beyondLimit.extensions = { values: new Array(5_001).fill(0) };
    expect(failureCodes(decodeContentPackMetadataV1(beyondLimit))).toContain('array_too_large');
  });
});

describe('prototype-safe untrusted dictionaries', () => {
  it('preserves dangerous extension keys as inert own data at every nesting level', () => {
    const candidate = contentMetadata();
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":"no"},"constructor":{"prototype":{"polluted":"no"}},"prototype":true}',
    ) as Record<string, unknown>;
    (candidate as unknown as Record<string, unknown>).extensions = malicious;
    const extensions = success(decodeContentPackMetadataV1(candidate)).extensions!;
    expect(Object.getPrototypeOf(extensions)).toBeNull();
    expect(Object.getPrototypeOf(extensions.__proto__ as object)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(extensions, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(extensions, 'constructor')).toBe(true);
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it('uses null-prototype rule options and preserves __proto__ as data', () => {
    const candidate = campaignProfile();
    candidate.ruleOptions = JSON.parse(
      '{"__proto__":"literal","constructor":true,"prototype":3}',
    ) as typeof candidate.ruleOptions;
    const options = success(decodeCampaignProfileV1(candidate)).ruleOptions;
    expect(Object.getPrototypeOf(options)).toBeNull();
    expect(options.__proto__).toBe('literal');
    expect(options.constructor).toBe(true);
  });

  it('uses safe records for stats and resources with attacker-controlled keys', () => {
    const candidate = character();
    candidate.stats.characteristics = JSON.parse(
      '{"__proto__":{"label":"Proto","short":"P","base":1,"advances":0}}',
    ) as typeof candidate.stats.characteristics;
    candidate.stats.skills = JSON.parse(
      '{"constructor":{"name":"Construct","characteristicKey":"__proto__","advances":0,"career":false,"advanced":false}}',
    ) as typeof candidate.stats.skills;
    candidate.resources = JSON.parse(
      '{"prototype":{"current":2}}',
    ) as typeof candidate.resources;
    const value = success(decodeCharacterDocumentV2(candidate));
    expect(Object.getPrototypeOf(value.stats)).toBeNull();
    expect(Object.getPrototypeOf(value.stats.characteristics)).toBeNull();
    expect(Object.getPrototypeOf(value.stats.skills)).toBeNull();
    expect(Object.getPrototypeOf(value.resources)).toBeNull();
    expect(value.stats.characteristics.__proto__.label).toBe('Proto');
    expect(value.resources.prototype.current).toBe(2);
  });

  it('keeps abilities, userContent, and equipment state safe and inert', () => {
    const candidate = character();
    (candidate.abilities as unknown as Record<string, unknown>).extensions = JSON.parse(
      '{"__proto__":"ability-data"}',
    );
    candidate.userContent = JSON.parse('{"__proto__":"user-data"}') as typeof candidate.userContent;
    candidate.state.equipmentState = JSON.parse(
      '{"constructor":"equipment-data"}',
    ) as typeof candidate.state.equipmentState;
    const value = success(decodeCharacterDocumentV2(candidate));
    expect(Object.getPrototypeOf(value.abilities)).toBeNull();
    expect(Object.getPrototypeOf(value.abilities.extensions!)).toBeNull();
    expect(Object.getPrototypeOf(value.userContent)).toBeNull();
    expect(Object.getPrototypeOf(value.state.equipmentState)).toBeNull();
    expect(value.abilities.extensions!.__proto__).toBe('ability-data');
  });
});

describe('ExchangeEnvelopeV1 structural and semantic boundaries', () => {
  it('decodes a consistent envelope using contentPackMetadata', () => {
    const value = success(decodeExchangeEnvelopeV1(envelope()));
    expect(value.contentPackMetadata[0].$schema).toBe('grimcomp.content-metadata.v1');
  });

  it('rejects duplicate IDs in each exchange collection', () => {
    const candidate = envelope();
    candidate.characters.push(clone(candidate.characters[0]));
    candidate.sourceProfiles.push(clone(candidate.sourceProfiles[0]));
    candidate.campaignProfiles.push(clone(candidate.campaignProfiles[0]));
    candidate.contentPackMetadata.push(clone(candidate.contentPackMetadata[0]));
    const codes = failureCodes(decodeExchangeEnvelopeV1(candidate));
    expect(codes.filter(code => code === 'duplicate_id')).toHaveLength(4);
  });

  it('keys content metadata identity by id and version', () => {
    const differentVersion = envelope();
    const versionTwo = contentMetadata();
    versionTwo.version = '2.0.0';
    differentVersion.contentPackMetadata.push(versionTwo);
    expect(decodeExchangeEnvelopeV1(differentVersion).ok).toBe(true);

    const duplicateTuple = envelope();
    duplicateTuple.contentPackMetadata.push(clone(duplicateTuple.contentPackMetadata[0]));
    expect(failureCodes(decodeExchangeEnvelopeV1(duplicateTuple))).toContain('duplicate_id');
  });

  it('requires every selected source pack to resolve to matching metadata', () => {
    const missingPin = envelope();
    missingPin.sourceProfiles[0].packs[0].pinnedVersion = '2.0.0';
    missingPin.sourceProfiles[0].packs[0].versionRange = '^2.0.0';
    expect(failureCodes(decodeExchangeEnvelopeV1(missingPin))).toContain('missing_reference');

    const wrongRuleset = envelope();
    wrongRuleset.contentPackMetadata[0].rulesetRef = ruleset('5e');
    expect(failureCodes(decodeExchangeEnvelopeV1(wrongRuleset))).toContain('ruleset_mismatch');
  });

  it('honors block, warn, disabled, and required missing-pack policies', () => {
    const blocked = envelope();
    blocked.characters = [];
    blocked.campaignProfiles = [];
    blocked.contentPackMetadata = [];
    const blockedResult = decodeExchangeEnvelopeV1(blocked);
    expect(blockedResult.ok).toBe(false);
    expect(blockedResult.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing_reference',
      severity: 'error',
    }));

    const warned = envelope();
    warned.characters = [];
    warned.campaignProfiles = [];
    warned.contentPackMetadata = [];
    warned.sourceProfiles[0].policy.missingPack = 'warn';
    const warnedResult = decodeExchangeEnvelopeV1(warned);
    expect(warnedResult.ok).toBe(true);
    expect(warnedResult.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing_reference',
      severity: 'warning',
    }));

    const disabled = envelope();
    disabled.characters = [];
    disabled.campaignProfiles = [];
    disabled.contentPackMetadata = [];
    disabled.sourceProfiles[0].packs[0].enabled = false;
    const disabledResult = decodeExchangeEnvelopeV1(disabled);
    expect(disabledResult.ok).toBe(true);
    expect(disabledResult.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'missing_reference',
    }));

    const required = clone(disabled);
    required.sourceProfiles[0].policy.missingPack = 'warn';
    required.sourceProfiles[0].packs[0].required = true;
    const requiredResult = decodeExchangeEnvelopeV1(required);
    expect(requiredResult.ok).toBe(false);
    expect(requiredResult.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing_reference',
      severity: 'error',
    }));
  });

  it('validates local SemVer text and enforces unpinned version ranges', () => {
    const malformedVersion = contentMetadata();
    malformedVersion.version = '01.0.0';
    expect(failureCodes(decodeContentPackMetadataV1(malformedVersion))).toContain('invalid_version');

    const malformedRange = sourceProfile();
    malformedRange.packs[0].versionRange = '>=';
    expect(failureCodes(decodeSourceProfileV1(malformedRange))).toContain('invalid_version_range');

    const incompatible = envelope();
    incompatible.characters = [];
    incompatible.campaignProfiles = [];
    delete incompatible.sourceProfiles[0].packs[0].pinnedVersion;
    delete incompatible.sourceProfiles[0].packs[0].pinnedHash;
    incompatible.contentPackMetadata[0].version = '9.0.0';
    expect(failureCodes(decodeExchangeEnvelopeV1(incompatible))).toContain('version_mismatch');
  });

  it('validates campaign locks against source selections and metadata snapshots', () => {
    const missingEnabledLock = envelope();
    missingEnabledLock.campaignProfiles[0].packLock = [];
    expect(failureCodes(decodeExchangeEnvelopeV1(missingEnabledLock))).toContain('missing_reference');

    const mismatchedHash = envelope();
    mismatchedHash.campaignProfiles[0].packLock[0].hash = LEGACY_ENTRY_HASH;
    expect(failureCodes(decodeExchangeEnvelopeV1(mismatchedHash))).toContain('snapshot_mismatch');

    const mismatchedVersion = envelope();
    const versionTwo = contentMetadata();
    versionTwo.version = '2.0.0';
    mismatchedVersion.contentPackMetadata.push(versionTwo);
    mismatchedVersion.campaignProfiles[0].packLock[0].version = '2.0.0';
    const mismatchedVersionCodes = failureCodes(decodeExchangeEnvelopeV1(mismatchedVersion));
    expect(mismatchedVersionCodes).toEqual(expect.arrayContaining([
      'version_mismatch',
      'snapshot_mismatch',
    ]));
  });

  it('requires campaign locks to contain exactly the active selections in source order', () => {
    const reversed = envelope();
    reversed.characters = [];
    const otherSelection = {
      ...clone(reversed.sourceProfiles[0].packs[0]),
      id: 'other.rules',
      order: 1,
      pinnedHash: LEGACY_ENTRY_HASH,
    };
    reversed.sourceProfiles[0].packs.push(otherSelection);
    reversed.contentPackMetadata.push(contentMetadata('other.rules'));
    reversed.campaignProfiles[0].packLock.push({
      id: 'other.rules',
      version: '1.0.0',
      hash: LEGACY_ENTRY_HASH,
    });
    reversed.campaignProfiles[0].packLock.reverse();
    expect(failureCodes(decodeExchangeEnvelopeV1(reversed))).toContain('snapshot_mismatch');

    const unrelatedDisabled = envelope();
    unrelatedDisabled.characters = [];
    unrelatedDisabled.sourceProfiles[0].packs.push({
      ...otherSelection,
      enabled: false,
    });
    unrelatedDisabled.contentPackMetadata.push(contentMetadata('other.rules'));
    unrelatedDisabled.campaignProfiles[0].packLock.push({
      id: 'other.rules',
      version: '1.0.0',
      hash: LEGACY_ENTRY_HASH,
    });
    expect(failureCodes(decodeExchangeEnvelopeV1(unrelatedDisabled))).toContain('snapshot_mismatch');
  });

  it('enforces rights-review and homebrew source policies', () => {
    const rejected = envelope();
    rejected.characters = [];
    rejected.campaignProfiles = [];
    rejected.contentPackMetadata[0].rights.reviewStatus = 'rejected';
    expect(failureCodes(decodeExchangeEnvelopeV1(rejected))).toContain('rights_policy_violation');

    const homebrewBlocked = envelope();
    homebrewBlocked.characters = [];
    homebrewBlocked.campaignProfiles = [];
    homebrewBlocked.sourceProfiles[0].policy.allowHomebrew = false;
    expect(failureCodes(decodeExchangeEnvelopeV1(homebrewBlocked))).toContain(
      'rights_policy_violation',
    );
  });

  it('enforces required dependencies and active pack conflicts', () => {
    const missingDependency = envelope();
    missingDependency.characters = [];
    missingDependency.campaignProfiles = [];
    missingDependency.contentPackMetadata[0].dependencies.push({
      id: 'missing.rules',
      versionRange: '^1.0.0',
    });
    expect(failureCodes(decodeExchangeEnvelopeV1(missingDependency))).toContain(
      'missing_reference',
    );

    const optionalDependency = clone(missingDependency);
    optionalDependency.contentPackMetadata[0].dependencies[0].optional = true;
    expect(decodeExchangeEnvelopeV1(optionalDependency).ok).toBe(true);

    const mixedPins = envelope();
    mixedPins.characters = [];
    mixedPins.campaignProfiles = [];
    mixedPins.contentPackMetadata[0].dependencies.push({
      id: 'other.rules',
      versionRange: '^1.0.0',
    });
    const unpinnedSelection = {
      ...clone(mixedPins.sourceProfiles[0].packs[0]),
      id: 'other.rules',
      order: 1,
    };
    delete unpinnedSelection.pinnedVersion;
    delete unpinnedSelection.pinnedHash;
    mixedPins.sourceProfiles[0].packs.push(unpinnedSelection);
    mixedPins.contentPackMetadata.push(contentMetadata('other.rules'));
    expect(decodeExchangeEnvelopeV1(mixedPins).ok).toBe(true);

    const unconditionalMixedConflict = clone(mixedPins);
    unconditionalMixedConflict.contentPackMetadata[0].dependencies = [];
    unconditionalMixedConflict.contentPackMetadata[0].conflicts = [{ id: 'other.rules' }];
    expect(failureCodes(decodeExchangeEnvelopeV1(unconditionalMixedConflict))).toContain(
      'pack_conflict',
    );

    const rangedAlternatives = clone(unconditionalMixedConflict);
    rangedAlternatives.sourceProfiles[0].packs[1].versionRange = '*';
    rangedAlternatives.contentPackMetadata[0].conflicts[0].versionRange = '^1.0.0';
    const otherVersionTwo = contentMetadata('other.rules');
    otherVersionTwo.version = '2.0.0';
    rangedAlternatives.contentPackMetadata.push(otherVersionTwo);
    expect(decodeExchangeEnvelopeV1(rangedAlternatives).ok).toBe(true);

    const dependencyForcesConflict = clone(rangedAlternatives);
    dependencyForcesConflict.contentPackMetadata[0].dependencies = [{
      id: 'other.rules',
      versionRange: '^1.0.0',
    }];
    expect(failureCodes(decodeExchangeEnvelopeV1(dependencyForcesConflict))).toContain(
      'pack_conflict',
    );

    const conflictUnion = clone(rangedAlternatives);
    conflictUnion.sourceProfiles[0].packs.push({
      ...clone(conflictUnion.sourceProfiles[0].packs[0]),
      id: 'third.rules',
      order: 2,
      pinnedHash: SOURCE_RESOLUTION_HASH,
    });
    const thirdMetadata = contentMetadata('third.rules');
    thirdMetadata.conflicts.push({ id: 'other.rules', versionRange: '^2.0.0' });
    conflictUnion.contentPackMetadata.push(thirdMetadata);
    expect(failureCodes(decodeExchangeEnvelopeV1(conflictUnion))).toContain('pack_conflict');

    const candidateDeclaresConflict = clone(mixedPins);
    candidateDeclaresConflict.contentPackMetadata[1].conflicts.push({ id: 'core.rules' });
    expect(failureCodes(decodeExchangeEnvelopeV1(candidateDeclaresConflict))).toContain(
      'resolution_impossible',
    );

    const candidateHasSafeAlternative = clone(candidateDeclaresConflict);
    candidateHasSafeAlternative.sourceProfiles[0].packs[1].versionRange = '*';
    candidateHasSafeAlternative.contentPackMetadata[0].dependencies[0].versionRange = '*';
    const safeOtherVersion = contentMetadata('other.rules');
    safeOtherVersion.version = '2.0.0';
    candidateHasSafeAlternative.contentPackMetadata.push(safeOtherVersion);
    expect(decodeExchangeEnvelopeV1(candidateHasSafeAlternative).ok).toBe(true);

    const candidateNeedsMissingDependency = clone(mixedPins);
    candidateNeedsMissingDependency.contentPackMetadata[1].dependencies.push({
      id: 'absent.rules',
      versionRange: '^1.0.0',
    });
    expect(failureCodes(decodeExchangeEnvelopeV1(candidateNeedsMissingDependency))).toContain(
      'resolution_impossible',
    );

    const activeConflict = envelope();
    activeConflict.characters = [];
    activeConflict.campaignProfiles = [];
    activeConflict.sourceProfiles[0].packs.push({
      ...clone(activeConflict.sourceProfiles[0].packs[0]),
      id: 'other.rules',
      order: 1,
      pinnedHash: LEGACY_ENTRY_HASH,
    });
    activeConflict.contentPackMetadata.push(contentMetadata('other.rules'));
    activeConflict.contentPackMetadata[0].conflicts.push({
      id: 'other.rules',
      versionRange: '^1.0.0',
    });
    expect(failureCodes(decodeExchangeEnvelopeV1(activeConflict))).toContain('pack_conflict');

    const partialResolution = clone(activeConflict);
    partialResolution.sourceProfiles[0].policy.missingPack = 'warn';
    partialResolution.sourceProfiles[0].packs.splice(1, 0, {
      ...clone(partialResolution.sourceProfiles[0].packs[0]),
      id: 'missing.rules',
      order: 1,
      pinnedHash: PORTABLE_RESOLUTION_HASH,
    });
    partialResolution.sourceProfiles[0].packs[2].order = 2;
    const partialResult = decodeExchangeEnvelopeV1(partialResolution);
    expect(partialResult.ok).toBe(false);
    expect(partialResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_reference', severity: 'warning' }),
      expect.objectContaining({ code: 'pack_conflict', severity: 'error' }),
    ]));

    const incompatibleWarned = envelope();
    incompatibleWarned.characters = [];
    incompatibleWarned.campaignProfiles = [];
    incompatibleWarned.sourceProfiles[0].policy.missingPack = 'warn';
    incompatibleWarned.contentPackMetadata[0].rulesetRef = ruleset('5e');
    incompatibleWarned.contentPackMetadata[0].dependencies.push({
      id: 'missing.rules',
      versionRange: '^1.0.0',
    });
    const incompatibleResult = decodeExchangeEnvelopeV1(incompatibleWarned);
    expect(incompatibleResult.ok).toBe(true);
    expect(incompatibleResult.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ruleset_mismatch',
      severity: 'warning',
    }));
    expect(incompatibleResult.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'missing_reference',
    }));
  });

  it('resolves exactly 128 relationship-bearing ambiguous packs within the CSP limit', () => {
    const result = decodeExchangeEnvelopeV1(ambiguityBoundaryEnvelope(128));
    expect(result.ok, result.diagnostics.map(diagnostic => diagnostic.message).join('\n')).toBe(true);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'resolution_limit',
    }));
  });

  it('fails closed at 129 ambiguous packs before structural decode limits', () => {
    const result = decodeExchangeEnvelopeV1(ambiguityBoundaryEnvelope(129));
    expect(failureCodes(result)).toContain('resolution_limit');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'decode_node_limit',
    }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'array_too_large',
    }));
  });

  it('bounds adversarial relationship work before the candidate-attempt limit', () => {
    // Six colors resolve K6 immediately, while K7 is not six-colorable. The K7
    // search exceeds the work budget in fewer than 20,000 candidate attempts.
    expect(decodeExchangeEnvelopeV1(graphColoringEnvelope(6, 6)).ok).toBe(true);

    const result = decodeExchangeEnvelopeV1(graphColoringEnvelope(7, 6));
    expect(failureCodes(result)).toEqual(['resolution_limit']);
  });

  it('requires campaign lock entries to be selected and house rules to be locked', () => {
    const unselectedLock = envelope();
    unselectedLock.campaignProfiles[0].packLock[0].id = 'other.rules';
    const otherMetadata = contentMetadata('other.rules');
    unselectedLock.contentPackMetadata.push(otherMetadata);
    expect(failureCodes(decodeExchangeEnvelopeV1(unselectedLock))).toContain('missing_reference');

    const missingHouseRule = envelope();
    missingHouseRule.campaignProfiles[0].houseRulePackIds = ['house.rules'];
    const houseRuleResult = decodeExchangeEnvelopeV1(missingHouseRule);
    expect(failureCodes(houseRuleResult)).toContain('missing_reference');
    expect(houseRuleResult.diagnostics.filter(diagnostic => (
      diagnostic.code === 'missing_reference'
      && diagnostic.path.join('.') === 'campaignProfiles.0.houseRulePackIds.0'
    ))).toHaveLength(1);
  });

  it('requires campaign-bound character hashes and supplied locks to match the campaign', () => {
    const hashOnly = envelope();
    hashOnly.characters = [character({
      kind: 'campaign',
      campaignProfileId: 'campaign.one',
      resolutionHash: CAMPAIGN_RESOLUTION_HASH,
    })];
    expect(decodeExchangeEnvelopeV1(hashOnly).ok).toBe(true);

    const wrongHash = envelope();
    wrongHash.characters = [character({
      kind: 'campaign',
      campaignProfileId: 'campaign.one',
      resolutionHash: PORTABLE_RESOLUTION_HASH,
    })];
    expect(failureCodes(decodeExchangeEnvelopeV1(wrongHash))).toContain('snapshot_mismatch');

    const wrongLock = envelope();
    wrongLock.characters = [character({
      kind: 'campaign',
      campaignProfileId: 'campaign.one',
      resolutionHash: CAMPAIGN_RESOLUTION_HASH,
      packLock: [{ id: 'core.rules', version: '1.0.0', hash: LEGACY_ENTRY_HASH }],
    })];
    expect(failureCodes(decodeExchangeEnvelopeV1(wrongLock))).toContain('snapshot_mismatch');
  });

  it('rejects resolved character pack references outside the bound source snapshot', () => {
    const candidate = envelope();
    const sheet = candidate.characters[0];
    const missingRef = { id: 'missing.definition', packId: 'missing.pack' };
    sheet.identity.speciesRef = clone(missingRef);
    sheet.identity.careerRef = clone(missingRef);
    sheet.progression.careerHistory[0].careerRef = clone(missingRef);
    sheet.stats.skills.cool.definitionRef = clone(missingRef);
    sheet.abilities.talents[0].definitionRef = clone(missingRef);
    sheet.abilities.spells[0].definitionRef = clone(missingRef);
    (sheet.abilities.prayers as unknown as Array<Record<string, unknown>>).push({
      name: 'Missing Prayer',
      definitionRef: clone(missingRef),
    });
    (sheet.abilities.traits[0] as unknown as Record<string, unknown>).definitionRef = clone(missingRef);
    (sheet.inventory[0] as unknown as Record<string, unknown>).definitionRef = clone(missingRef);
    (sheet.state.conditions[0] as unknown as Record<string, unknown>).definitionRef = clone(missingRef);
    (sheet.state.criticals[0] as unknown as Record<string, unknown>).definitionRef = clone(missingRef);
    (sheet.state.mutations[0] as unknown as Record<string, unknown>).definitionRef = clone(missingRef);

    const result = decodeExchangeEnvelopeV1(candidate);
    expect(result.ok).toBe(false);
    for (const path of [
      ['characters', 0, 'identity', 'speciesRef', 'packId'],
      ['characters', 0, 'identity', 'careerRef', 'packId'],
      ['characters', 0, 'progression', 'careerHistory', 0, 'careerRef', 'packId'],
      ['characters', 0, 'stats', 'skills', 'cool', 'definitionRef', 'packId'],
      ['characters', 0, 'abilities', 'talents', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'abilities', 'spells', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'abilities', 'prayers', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'abilities', 'traits', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'inventory', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'state', 'conditions', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'state', 'criticals', 0, 'definitionRef', 'packId'],
      ['characters', 0, 'state', 'mutations', 0, 'definitionRef', 'packId'],
    ] as const) {
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: 'missing_reference',
        path,
      }));
    }
  });

  it('requires source provenance on resolved references in bound characters', () => {
    const candidate = envelope();
    delete (candidate.characters[0].identity.speciesRef as unknown as Record<string, unknown>).packId;
    const result = decodeExchangeEnvelopeV1(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing_reference',
      path: ['characters', 0, 'identity', 'speciesRef', 'packId'],
    }));
  });

  it('uses the campaign lock as the pack boundary for campaign-bound characters', () => {
    const candidate = envelope();
    candidate.characters = [character({
      kind: 'campaign',
      campaignProfileId: 'campaign.one',
      resolutionHash: CAMPAIGN_RESOLUTION_HASH,
    })];
    candidate.characters[0].identity.speciesRef.packId = 'missing.pack';
    const result = decodeExchangeEnvelopeV1(candidate);
    expect(failureCodes(result)).toContain('missing_reference');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing_reference',
      path: ['characters', 0, 'identity', 'speciesRef', 'packId'],
    }));
  });

  it('treats V1 envelopes as self-contained for pack metadata', () => {
    const candidate = envelope();
    candidate.contentPackMetadata = [];
    expect(failureCodes(decodeExchangeEnvelopeV1(candidate))).toContain('missing_reference');
  });

  it('rejects missing profile references only at envelope semantic validation', () => {
    const standalone = character({
      kind: 'source',
      sourceProfileId: 'not-in-envelope',
      resolutionHash: PORTABLE_RESOLUTION_HASH,
    });
    expect(decodeCharacterDocumentV2(standalone).ok).toBe(true);
    const candidate = envelope();
    candidate.characters = [standalone];
    expect(failureCodes(decodeExchangeEnvelopeV1(candidate))).toContain('missing_reference');
  });

  it('rejects campaign/source and character/profile ruleset mismatches', () => {
    const candidate = envelope();
    candidate.campaignProfiles[0].rulesetRef = ruleset('5e');
    candidate.characters[0].rulesetRef = ruleset('5e');
    const codes = failureCodes(decodeExchangeEnvelopeV1(candidate));
    expect(codes.filter(code => code === 'ruleset_mismatch').length).toBeGreaterThanOrEqual(2);
  });

  it('rejects the old contentPacks envelope migration shape', () => {
    const old = envelope() as unknown as Record<string, unknown>;
    old.contentPacks = old.contentPackMetadata;
    delete old.contentPackMetadata;
    expect(decodeExchangeEnvelopeV1(old).ok).toBe(false);
  });
});
