import { describe, expect, it } from 'vitest';
import {
  adaptLegacyCharacterV1,
  adaptLegacyRosterV1,
  decodeCharacterDocumentV2,
  decodeExchangeEnvelopeV1,
  type Diagnostic,
  type LegacyCharacterAdapterContext,
  type LegacyCharacterSourceV1,
  type LegacyEnvelopeContext,
} from '@grimcomp/core';
import commonInput from '../../packages/core/fixtures/legacy-v1/common-input.json';
import commonContext from '../../packages/core/fixtures/legacy-v1/common-context.json';
import commonEnvelopeContext from '../../packages/core/fixtures/legacy-v1/common-envelope-context.json';
import commonExpectedCharacter from '../../packages/core/fixtures/legacy-v1/common-expected-character.json';
import commonExpectedDiagnostics from '../../packages/core/fixtures/legacy-v1/common-expected-diagnostics.json';
import commonExpectedEnvelope from '../../packages/core/fixtures/legacy-v1/common-expected-envelope.json';
import auditAdversarial from '../../packages/core/fixtures/legacy-v1/audit-adversarial.json';
import malformedInput from '../../packages/core/fixtures/legacy-v1/malformed-input.json';
import unresolvedInput from '../../packages/core/fixtures/legacy-v1/unresolved-input.json';
import unresolvedContext from '../../packages/core/fixtures/legacy-v1/unresolved-context.json';
import unresolvedExpected from '../../packages/core/fixtures/legacy-v1/unresolved-expected.json';
import unresolvedExpectedDiagnostics from '../../packages/core/fixtures/legacy-v1/unresolved-expected-diagnostics.json';

const source = commonInput as LegacyCharacterSourceV1;
const context = commonContext as LegacyCharacterAdapterContext;

function reversedObjectOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedObjectOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, nested]) => [key, reversedObjectOrder(nested)]),
  );
}

function diagnosticIdentities(diagnostics: readonly Diagnostic[]): Array<[string, readonly (string | number)[]]> {
  return diagnostics.map(diagnostic => [diagnostic.code, diagnostic.path]);
}

describe('legacy v1 character adapter', () => {
  it('matches the common golden character and strict V2 decoder', () => {
    const result = adaptLegacyCharacterV1(source, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(commonExpectedCharacter);
    expect(result.diagnostics).toEqual(commonExpectedDiagnostics);
    expect(decodeCharacterDocumentV2(result.value).ok).toBe(true);
    expect(result.value.progression.experience.entries[0]).not.toHaveProperty('occurredAt');
    expect(result.value.progression.experience.entries[0].dateLabel).toBe('2525.33.99');
    expect(result.value.identity).not.toHaveProperty('accent');
    expect(result.value.userContent.avatarAccent).toBe('#884422');
  });

  it('is repeatable and independent of input object property order', () => {
    const first = adaptLegacyCharacterV1(source, context);
    const second = adaptLegacyCharacterV1(source, context);
    const reversed = adaptLegacyCharacterV1(
      reversedObjectOrder(commonInput) as LegacyCharacterSourceV1,
      reversedObjectOrder(commonContext) as LegacyCharacterAdapterContext,
    );

    expect(first.ok && second.ok && reversed.ok).toBe(true);
    if (!first.ok || !second.ok || !reversed.ok) return;
    expect(JSON.stringify(second.value)).toBe(JSON.stringify(first.value));
    expect(JSON.stringify(reversed.value)).toBe(JSON.stringify(first.value));
    expect(reversed.diagnostics).toEqual(first.diagnostics);
  });

  it('keeps unresolved and ambiguous identities explicit without fabricating refs', () => {
    const result = adaptLegacyCharacterV1(
      unresolvedInput as LegacyCharacterSourceV1,
      unresolvedContext as LegacyCharacterAdapterContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unresolvedRefs).toEqual(unresolvedExpected.unresolvedRefs);
    expect(Object.values(result.value.stats.skills).map(skill => skill.advances)).toEqual(
      unresolvedExpected.skillAdvances,
    );
    expect(result.value.abilities.talents.map(talent => talent.rank)).toEqual(
      unresolvedExpected.talentRanks,
    );
    expect(result.value.abilities.spells).toEqual(unresolvedExpected.spells);
    expect(result.value.identity).not.toHaveProperty('speciesRef');
    expect(result.value.identity).not.toHaveProperty('careerRef');
    expect(result.value.abilities.talents[0]).not.toHaveProperty('definitionRef');
    expect(diagnosticIdentities(result.diagnostics)).toEqual(unresolvedExpectedDiagnostics);
    expect(result.value.notes).toEqual([]);
    expect(result.value.userContent).not.toHaveProperty('notes');
    expect(result.value.userContent).not.toHaveProperty('xpRule');
    expect(result.value.legacyExtensions?.legacyV1).toHaveProperty('overlays.notes');
    const preservedOverlays = result.value.legacyExtensions?.legacyV1;
    expect(
      preservedOverlays && typeof preservedOverlays === 'object' && !Array.isArray(preservedOverlays)
        ? (preservedOverlays.overlays as Record<string, unknown>)['settings.xpRule']
        : undefined,
    ).toBe('flexible');
  });

  it('fails a malformed fixture and never substitutes a fallback template', () => {
    const malformed = adaptLegacyCharacterV1(
      malformedInput as LegacyCharacterSourceV1,
      context,
    );
    const missingTemplate = adaptLegacyCharacterV1(
      { character: undefined, overlays: {} } as LegacyCharacterSourceV1,
      context,
    );

    expect(malformed.ok).toBe(false);
    expect(malformed.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true);
    expect(missingTemplate.ok).toBe(false);
  });

  it('fails closed on cycles, accessors, hostile proxies, non-finite data, and limits', () => {
    const cyclicCharacter = JSON.parse(JSON.stringify(commonInput.character)) as Record<string, unknown>;
    cyclicCharacter.cycle = cyclicCharacter;

    const accessorSource: Record<string, unknown> = { overlays: {} };
    Object.defineProperty(accessorSource, 'character', {
      enumerable: true,
      get: () => commonInput.character,
    });

    const hostileSource = new Proxy({ character: commonInput.character, overlays: {} }, {
      ownKeys: () => { throw new Error('hostile ownKeys'); },
    });

    const nonfinite = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    (nonfinite.character as Record<string, unknown>).age = Number.POSITIVE_INFINITY;

    const tooLarge = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    (tooLarge.character as Record<string, unknown>).psychology = Array.from({ length: 5_001 }, () => 'Fear');

    const tooManyKeys = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    tooManyKeys.overlays = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`unknown.${index}`, index]),
    );

    const results = [
      adaptLegacyCharacterV1({ character: cyclicCharacter, overlays: {} }, context),
      adaptLegacyCharacterV1(accessorSource as unknown as LegacyCharacterSourceV1, context),
      adaptLegacyCharacterV1(hostileSource as unknown as LegacyCharacterSourceV1, context),
      adaptLegacyCharacterV1(nonfinite as unknown as LegacyCharacterSourceV1, context),
      adaptLegacyCharacterV1(tooLarge as unknown as LegacyCharacterSourceV1, context),
      adaptLegacyCharacterV1(tooManyKeys as unknown as LegacyCharacterSourceV1, context),
    ];

    expect(results.every(result => !result.ok)).toBe(true);
    expect(results.flatMap(result => result.diagnostics).map(diagnostic => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'cyclic_extension',
        'unreadable_input',
        'nonfinite_number',
        'array_too_large',
        'decode_node_limit',
      ]),
    );
  });

  it('requires caller-supplied timestamps and a real profile binding', () => {
    const missingTimestamp = adaptLegacyCharacterV1(source, {
      ...context,
      createdAt: undefined,
    } as unknown as LegacyCharacterAdapterContext);
    const fakeDetachedHash = adaptLegacyCharacterV1(source, {
      ...context,
      profileBinding: { kind: 'detached', resolutionHash: 'not-a-hash' as never },
    });

    expect(missingTimestamp.ok).toBe(false);
    expect(fakeDetachedHash.ok).toBe(false);
    expect(fakeDetachedHash.diagnostics.some(diagnostic => diagnostic.code === 'invalid_hash')).toBe(true);
  });
});

describe('legacy v1 roster adapter', () => {
  it('matches the composed envelope golden and passes structural and semantic decoding', () => {
    const result = adaptLegacyRosterV1(
      [{ source, context }],
      commonEnvelopeContext as LegacyEnvelopeContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ ...commonExpectedEnvelope, characters: [commonExpectedCharacter] });
    expect(decodeExchangeEnvelopeV1(commonExpectedEnvelope).ok).toBe(true);
    expect(decodeExchangeEnvelopeV1(result.value).ok).toBe(true);
    expect(result.value.sourceProfiles).toEqual([]);
    expect(result.value.contentPackMetadata).toEqual([]);
  });

  it('fails the whole envelope when an entry has no exact source template', () => {
    const result = adaptLegacyRosterV1(
      [
        { source, context },
        { source: { character: undefined, overlays: {} } as LegacyCharacterSourceV1, context },
      ],
      commonEnvelopeContext as LegacyEnvelopeContext,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(diagnostic => (
      diagnostic.path[0] === 'roster'
      && diagnostic.path[1] === 'entries'
      && diagnostic.path[2] === 1
    ))).toBe(true);
  });
});

describe('legacy adapter audit regressions', () => {
  it('returns diagnostics instead of throwing for object-valued originKind', () => {
    const malformedContext = JSON.parse(JSON.stringify(commonContext)) as Record<string, unknown>;
    malformedContext.originKind = {};
    let result: ReturnType<typeof adaptLegacyCharacterV1> | undefined;

    expect(() => {
      result = adaptLegacyCharacterV1(
        source,
        malformedContext as unknown as LegacyCharacterAdapterContext,
      );
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid_enum',
      path: ['context', 'originKind'],
    }));
  });

  it('adapts lone-surrogate talent identities without throwing', () => {
    const surrogateInput = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    const character = surrogateInput.character as Record<string, unknown>;
    const talents = character.talents as Array<Record<string, unknown>>;
    talents[0].definitionId = String.fromCharCode(0xd800);
    let result: ReturnType<typeof adaptLegacyCharacterV1> | undefined;

    expect(() => {
      result = adaptLegacyCharacterV1(
        surrogateInput as unknown as LegacyCharacterSourceV1,
        context,
      );
    }).not.toThrow();
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(decodeCharacterDocumentV2(result.value).ok).toBe(true);
  });

  it('does not use ref.id fallback when the resolution declares any alias', () => {
    const aliasedContext = JSON.parse(JSON.stringify(commonContext)) as Record<string, unknown>;
    aliasedContext.resolutions = (aliasedContext.resolutions as Array<Record<string, unknown>>)
      .map(resolution => resolution.kind === 'species'
        ? auditAdversarial.aliasHijackResolution
        : resolution);

    const result = adaptLegacyCharacterV1(
      source,
      aliasedContext as unknown as LegacyCharacterAdapterContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity).not.toHaveProperty('speciesRef');
    expect(result.value.unresolvedRefs).toContainEqual(expect.objectContaining({
      path: 'identity.speciesRef',
      legacyKey: 'race.human',
      ref: { id: 'race.human' },
    }));
  });

  it('keeps definition ids case-sensitive when applying canonical talent ranks', () => {
    const caseInput = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    const character = caseInput.character as Record<string, unknown>;
    const talents = character.talents as Array<Record<string, unknown>>;
    talents[0].definitionId = auditAdversarial.caseSensitiveTalent.definitionId;
    const overlays = caseInput.overlays as Record<string, unknown>;
    overlays['talents.times'] = {
      [auditAdversarial.caseSensitiveTalent.correctRankKey]: auditAdversarial.caseSensitiveTalent.correctRank,
      [auditAdversarial.caseSensitiveTalent.wrongRankKey]: auditAdversarial.caseSensitiveTalent.wrongRank,
    };
    const caseContext = JSON.parse(JSON.stringify(commonContext)) as Record<string, unknown>;
    caseContext.resolutions = (caseContext.resolutions as Array<Record<string, unknown>>)
      .map(resolution => resolution.kind === 'talent'
        && (resolution.ref as Record<string, unknown>).id === 'talent.hardy'
        ? { kind: 'talent', ref: { id: auditAdversarial.caseSensitiveTalent.definitionId, name: 'Hardy' } }
        : resolution);

    const result = adaptLegacyCharacterV1(
      caseInput as unknown as LegacyCharacterSourceV1,
      caseContext as unknown as LegacyCharacterAdapterContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.abilities.talents[0].rank).toBe(auditAdversarial.caseSensitiveTalent.correctRank);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'legacy_unmapped_value',
      path: ['source', 'overlays', 'talents.times', auditAdversarial.caseSensitiveTalent.wrongRankKey],
    }));
  });

  it('bounds attacker-controlled values in diagnostics and unresolved reasons', () => {
    const longInput = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    const character = longInput.character as Record<string, unknown>;
    const longId = auditAdversarial.longDiagnostic.prefix
      + 'x'.repeat(auditAdversarial.longDiagnostic.repeat)
      + auditAdversarial.longDiagnostic.tail;
    character.raceId = longId;
    const noSpeciesContext = JSON.parse(JSON.stringify(commonContext)) as Record<string, unknown>;
    noSpeciesContext.resolutions = (noSpeciesContext.resolutions as Array<Record<string, unknown>>)
      .filter(resolution => resolution.kind !== 'species');

    const result = adaptLegacyCharacterV1(
      longInput as unknown as LegacyCharacterSourceV1,
      noSpeciesContext as unknown as LegacyCharacterAdapterContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagnostic = result.diagnostics.find(candidate => (
      candidate.code === 'legacy_unresolved_reference'
      && candidate.path.at(-1) === 'raceId'
    ));
    const unresolved = result.value.unresolvedRefs.find(candidate => candidate.path === 'identity.speciesRef');
    expect(diagnostic?.message.length).toBeLessThan(240);
    expect(diagnostic?.message).not.toContain(auditAdversarial.longDiagnostic.tail);
    expect(unresolved?.reason.length).toBeLessThan(240);
    expect(unresolved?.reason).not.toContain(auditAdversarial.longDiagnostic.tail);
    expect(unresolved?.legacyKey).toBe(longId);
  });

  it('rejects unknown roster-entry fields instead of silently dropping them', () => {
    const key = auditAdversarial.unknownRosterField.key;
    const result = adaptLegacyRosterV1(
      [{
        source,
        context,
        [key]: auditAdversarial.unknownRosterField.value,
      } as unknown as { source: LegacyCharacterSourceV1; context: LegacyCharacterAdapterContext }],
      commonEnvelopeContext as LegacyEnvelopeContext,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unknown_key',
      path: ['roster', 'entries', 0, key],
    }));
  });

  it('rejects contradictory stored career name and status snapshots', () => {
    const contradictoryInput = JSON.parse(JSON.stringify(commonInput)) as Record<string, unknown>;
    const character = contradictoryInput.character as Record<string, unknown>;
    character.careerLevelName = auditAdversarial.contradictoryCareer.careerLevelName;
    character.status = auditAdversarial.contradictoryCareer.status;

    const result = adaptLegacyCharacterV1(
      contradictoryInput as unknown as LegacyCharacterSourceV1,
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === 'snapshot_mismatch')).toEqual([
      expect.objectContaining({ path: ['source', 'character', 'careerLevelName'] }),
      expect.objectContaining({ path: ['source', 'character', 'status'] }),
    ]);
  });
});
