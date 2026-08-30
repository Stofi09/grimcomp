import {
  MAX_TRANSACTION_OPERATIONS,
  SETTINGS_BACKUP_FILE_LIMIT_LABEL,
  SETTINGS_BACKUP_SCHEMA,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  isPlatformPortableSettingsKey,
  isValidStorageKey,
  settingsBackupExceedsFileLimit,
  type StorageExclusiveLock,
} from '@grimcomp/core';
import type {
  StorageBackend,
  StorageCore,
  StorageMaintenanceTicket,
  StorageTransactionTicket,
} from '@/hooks/storageCore';
import {
  browserStorageBackend,
  browserStorageCore,
  createBrowserExclusiveLock,
} from '@/storage/browserStorage';
import type { ContentPack } from '@/content/types';
import { preserveRequiredFallbackCharacter } from '@/content/storedContentPacks';
import { FALLBACK_CHARACTER_ID } from '@/data/character';
import { STORAGE_VERSION, STORAGE_VERSION_KEY } from '@/storage/migrations';
import { STORAGE_RECOVERY_RESET_INTENT_KEY } from '@/storage/storageSchema';
import {
  validateCustomCharacterMap,
  validatePortableStorageValue,
  type SettingsValidationContext,
} from './settingsDataValidation';
import {
  resolvePostImportCharacterTemplateIds,
  type PostImportStoredPack,
} from './resolvePostImportCharacterTemplateIds';

export type ExportScope = 'character' | 'roster';

export interface SettingsImportSummary {
  readonly requested: number;
  readonly keys: readonly string[];
}

export interface BuildSettingsExportOptions extends SettingsValidationContext {
  readonly backend?: Pick<StorageBackend, 'getItem' | 'keys'>;
  readonly core?: Pick<StorageCore, 'getStatus'>;
  readonly withExclusiveLock?: StorageExclusiveLock;
  /** Immutable bundled layers used to resolve enabled packs and tombstones exactly. */
  readonly bundledContentPacks?: readonly ContentPack[];
}

export interface ApplySettingsImportOptions extends SettingsValidationContext {
  readonly core?: StorageCore;
  /** Immutable bundled layers used to resolve the exact post-import roster. */
  readonly bundledContentPacks?: readonly ContentPack[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function addPackCharacterIds(value: unknown, ids: Set<string>): void {
  if (!isRecord(value) || !Array.isArray(value.characters)) return;
  for (const candidate of value.characters) {
    if (isRecord(candidate) && typeof candidate.id === 'string') ids.add(candidate.id);
  }
}

/** Include character definitions arriving in content layers in collision checks. */
function validationContextForEntries(
  entries: readonly (readonly [string, unknown])[],
  builtInCharacterIds?: ReadonlySet<string>,
): SettingsValidationContext {
  const ids = new Set(builtInCharacterIds);
  for (const [key, value] of entries) {
    if (key === 'gc.content.userEdits') {
      addPackCharacterIds(value, ids);
      continue;
    }
    if (key !== 'gc.content.packs' || !Array.isArray(value)) continue;
    for (const candidate of value) {
      if (isRecord(candidate)) addPackCharacterIds(candidate.pack, ids);
    }
  }
  return { builtInCharacterIds: ids };
}

function validatedStoredPacks(
  value: unknown,
  label: string,
): readonly PostImportStoredPack[] {
  validatePortableStorageValue('gc.content.packs', value, label);
  return value as readonly PostImportStoredPack[];
}

function validatedUserEditsPack(
  value: unknown,
  label: string,
): ContentPack | undefined {
  if (value === undefined) return undefined;
  validatePortableStorageValue('gc.content.userEdits', value, label);
  return value as ContentPack;
}

function readStoredJson(
  backend: Pick<StorageBackend, 'getItem'>,
  key: string,
): unknown {
  const raw = backend.getItem(key);
  if (raw === null) return undefined;
  try { return JSON.parse(raw) as unknown; }
  catch { throw new Error(`Stored value ${JSON.stringify(key)} is not valid JSON.`); }
}

function packTouchesCharacter(pack: ContentPack, id: string): boolean {
  return (
    (pack.characters ?? []).some(character => character.id === id)
    || (pack.deletions?.characters ?? []).includes(id)
  );
}

/** Enumerate exportable keys. Access failures deliberately propagate to UI. */
export function grimCompanionStorageKeys(
  backend: Pick<StorageBackend, 'keys'> = browserStorageBackend,
): string[] {
  return backend.keys()
    .filter((key) => (
      key.startsWith('gc.')
      && isPlatformPortableSettingsKey(key)
      && key !== STORAGE_TRANSACTION_JOURNAL_KEY
      && key !== STORAGE_VERSION_KEY
      && key !== STORAGE_RECOVERY_RESET_INTENT_KEY
    ))
    .sort();
}

/** Build the portable payload used by the Settings export actions. */
export async function buildSettingsExport(
  scope: ExportScope,
  id: string,
  characterName: string,
  options: BuildSettingsExportOptions = {},
): Promise<string> {
  const {
    backend = browserStorageBackend,
    core = browserStorageCore,
    withExclusiveLock = createBrowserExclusiveLock(),
    builtInCharacterIds,
    bundledContentPacks,
  } = options;
  return withExclusiveLock(async () => {
    const expectedVersionRaw = JSON.stringify(STORAGE_VERSION);
    const observedVersionRaw = backend.getItem(STORAGE_VERSION_KEY);
    if (observedVersionRaw !== expectedVersionRaw) {
      throw new Error(
        `Local storage schema ${JSON.stringify(observedVersionRaw)} does not match the supported version ${expectedVersionRaw}.`,
      );
    }
    const before = core.getStatus();
    if (before.pending > 0 || before.dirty || before.blocked || !before.initialized) {
      throw new Error('Local storage is busy, dirty, or blocked; wait for saving/recovery before exporting.');
    }
    if (backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY) !== null) {
      throw new Error('A storage transaction journal is present; recover it before exporting.');
    }
    const keys = grimCompanionStorageKeys(backend);
    const wanted = scope === 'character'
      ? keys.filter(key => key.startsWith(`gc.${id}.`) || key === 'gc.activeCharId')
      : keys;
    const dump: Record<string, unknown> = {
      $schema: SETTINGS_BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      scope,
      character: scope === 'character' ? characterName : undefined,
    };
    for (const key of wanted) {
      if (!isValidStorageKey(key)) {
        throw new Error(`Stored key ${JSON.stringify(key)} is not a valid portable storage key.`);
      }
      const value = backend.getItem(key);
      if (value == null) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(value) as unknown; }
      catch { throw new Error(`Stored value ${JSON.stringify(key)} is not valid JSON.`); }
      dump[key] = parsed;
    }
    const snapshotEntries = wanted.flatMap((key): Array<readonly [string, unknown]> => (
      Object.prototype.hasOwnProperty.call(dump, key) ? [[key, dump[key]]] : []
    ));
    if (bundledContentPacks === undefined) {
      throw new Error(
        'Exact bundled content context is required for a portable settings export.',
      );
    }
    let snapshotValidationContext = validationContextForEntries(
      snapshotEntries,
      builtInCharacterIds,
    );
    if (scope === 'roster') {
      const storedPacksEntry = snapshotEntries.find(([key]) => key === 'gc.content.packs');
      const userEditsEntry = snapshotEntries.find(([key]) => key === 'gc.content.userEdits');
      const storedPacks = storedPacksEntry
        ? validatedStoredPacks(storedPacksEntry[1], 'Stored value')
        : [];
      const userEdits = userEditsEntry
        ? validatedUserEditsPack(userEditsEntry[1], 'Stored value')
        : undefined;
      const exactTemplateIds = resolvePostImportCharacterTemplateIds(
        bundledContentPacks,
        storedPacks,
        userEdits,
      );
      snapshotValidationContext = { builtInCharacterIds: exactTemplateIds };
      if (!exactTemplateIds.has(FALLBACK_CHARACTER_ID)) {
        throw new Error(
          `The locked roster does not contain required fallback character ${JSON.stringify(FALLBACK_CHARACTER_ID)}.`,
        );
      }
    }
    for (const [key, value] of snapshotEntries) {
      validatePortableStorageValue(key, value, 'Stored value', snapshotValidationContext);
    }
    if (scope === 'character') {
      const lockedActiveId = dump['gc.activeCharId'] ?? FALLBACK_CHARACTER_ID;
      if (lockedActiveId !== id) {
        throw new Error(
          `The active character changed to ${JSON.stringify(lockedActiveId)} before the export snapshot was read; retry the export.`,
        );
      }
      // A fresh/legacy store may rely on the in-memory fallback and have no
      // persisted pointer yet. Still make the character export self-contained.
      dump['gc.activeCharId'] = id;

      const storedPacksRaw = readStoredJson(backend, 'gc.content.packs');
      const userEditsRaw = readStoredJson(backend, 'gc.content.userEdits');
      const storedPacks = storedPacksRaw === undefined
        ? []
        : validatedStoredPacks(storedPacksRaw, 'Stored value');
      const userEdits = validatedUserEditsPack(userEditsRaw, 'Stored value');
      const exactTemplateIds = resolvePostImportCharacterTemplateIds(
        bundledContentPacks,
        storedPacks,
        userEdits,
      );
      const exactValidationContext = { builtInCharacterIds: exactTemplateIds };

      let existsAsCustom = false;
      const customRaw = backend.getItem('gc.customChars');
      if (customRaw !== null) {
        let storedCustom: unknown;
        try { storedCustom = JSON.parse(customRaw) as unknown; }
        catch { throw new Error('Stored value "gc.customChars" is not valid JSON.'); }
        const storedCustomMap = validateCustomCharacterMap(
          storedCustom,
          'Stored value',
          exactValidationContext,
        );
        if (Object.prototype.hasOwnProperty.call(storedCustomMap, id)) {
          dump['gc.customChars'] = { [id]: storedCustomMap[id] };
          existsAsCustom = true;
        }
      }
      const existsAsTemplate = exactTemplateIds.has(id);
      const importedLayerTouchesCharacter = storedPacks.some(
        stored => stored.enabled && packTouchesCharacter(stored.pack, id),
      ) || (userEdits !== undefined && packTouchesCharacter(userEdits, id));
      const bundledTemplateIds = resolvePostImportCharacterTemplateIds(
        bundledContentPacks,
        [],
      );
      if (
        existsAsTemplate
        && (!bundledTemplateIds.has(id) || importedLayerTouchesCharacter)
      ) {
        throw new Error(
          `Character ${JSON.stringify(id)} depends on imported or edited content; use a full roster export so its template remains portable.`,
        );
      }
      if (!existsAsTemplate && !existsAsCustom) {
        throw new Error(
          `The active character ${JSON.stringify(id)} does not exist in the locked export roster.`,
        );
      }
    } else {
      const activeId = dump['gc.activeCharId'] ?? FALLBACK_CHARACTER_ID;
      validatePortableStorageValue(
        'gc.activeCharId',
        activeId,
        'Stored value',
        snapshotValidationContext,
      );
      const custom = Object.prototype.hasOwnProperty.call(dump, 'gc.customChars')
        ? validateCustomCharacterMap(
            dump['gc.customChars'],
            'Stored value',
            snapshotValidationContext,
          )
        : Object.create(null) as Record<string, unknown>;
      const isTemplate = snapshotValidationContext.builtInCharacterIds?.has(activeId as string) ?? false;
      const isCustom = Object.prototype.hasOwnProperty.call(custom, activeId as string);
      if (!isTemplate && !isCustom) {
        throw new Error(
          `The active character ${JSON.stringify(activeId)} does not exist in the locked export roster.`,
        );
      }
    }
    const after = core.getStatus();
    if (after.pending > 0 || after.dirty || after.blocked || !after.initialized) {
      throw new Error('Local storage changed while the export snapshot was being read.');
    }
    if (backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY) !== null) {
      throw new Error('A storage transaction began while the export snapshot was being read.');
    }
    if (backend.getItem(STORAGE_VERSION_KEY) !== expectedVersionRaw) {
      throw new Error('The local storage schema changed while the export snapshot was being read.');
    }
    const serialized = JSON.stringify(dump, null, 2);
    if (settingsBackupExceedsFileLimit(serialized)) {
      throw new Error(
        `Portable backup is larger than the ${SETTINGS_BACKUP_FILE_LIMIT_LABEL} import limit.`,
      );
    }
    return serialized;
  });
}

/**
 * Stage an import as one crash-recoverable transaction. No key is published or
 * reported imported until the returned completion resolves successfully.
 */
export function applySettingsImport(
  dump: Readonly<Record<string, unknown>>,
  options: ApplySettingsImportOptions = {},
): StorageTransactionTicket<SettingsImportSummary> {
  const {
    core = browserStorageCore,
    builtInCharacterIds,
    bundledContentPacks,
  } = options;
  return core.transaction((draft) => {
    if (dump.$schema !== SETTINGS_BACKUP_SCHEMA) {
      throw new Error('Import must declare $schema as "grimcomp.v1".');
    }
    const status = core.getStatus();
    if (status.pending > 0 || status.coordinatorDirty || status.blocked || !status.initialized) {
      throw new Error('Local storage is busy, dirty, or blocked; import cannot start safely.');
    }

    const importable = Object.entries(dump).filter(([key]) => key.startsWith('gc.'));
    const reserved = importable.find(([key]) => (
      key === STORAGE_TRANSACTION_JOURNAL_KEY
      || key === STORAGE_VERSION_KEY
      || key === STORAGE_RECOVERY_RESET_INTENT_KEY
    ));
    if (reserved) {
      throw new Error(`Import contains a reserved internal storage key: ${JSON.stringify(reserved[0])}.`);
    }
    if (importable.length === 0) {
      throw new Error('Import contains no importable Grim Companion storage keys.');
    }
    if (importable.length > MAX_TRANSACTION_OPERATIONS) {
      throw new Error(`Import contains more than ${MAX_TRANSACTION_OPERATIONS} storage keys.`);
    }
    for (const [key, incoming] of importable) {
      if (!isValidStorageKey(key)) throw new Error(`Import contains an invalid storage key: ${JSON.stringify(key)}.`);
      let serialized: string | undefined;
      try { serialized = JSON.stringify(incoming); }
      catch (error) {
        throw new Error(`Import value ${JSON.stringify(key)} is not serializable: ${String(error)}`);
      }
      if (serialized === undefined) throw new Error(`Import value ${JSON.stringify(key)} is not serializable.`);
    }
    const importsContentLayer = importable.some(([key]) => (
      key === 'gc.content.packs' || key === 'gc.content.userEdits'
    ));
    const incomingCustomEntry = importable.find(([key]) => key === 'gc.customChars');
    const activeEntry = importable.find(([key]) => key === 'gc.activeCharId');
    const needsRosterResolution = importsContentLayer || incomingCustomEntry !== undefined || activeEntry !== undefined;
    if (
      needsRosterResolution
      && bundledContentPacks === undefined
      && (importsContentLayer || builtInCharacterIds === undefined)
    ) {
      throw new Error(
        'Exact bundled content or resolved character-template context is required for a roster-affecting import.',
      );
    }

    let validationContext = validationContextForEntries(importable, builtInCharacterIds);
    if (bundledContentPacks && needsRosterResolution) {
      const incomingPacksEntry = importable.find(([key]) => key === 'gc.content.packs');
      const incomingEditsEntry = importable.find(([key]) => key === 'gc.content.userEdits');
      const postImportPacksRaw = incomingPacksEntry
        ? incomingPacksEntry[1]
        : draft.read<unknown>('gc.content.packs', []);
      const postImportEditsRaw = incomingEditsEntry
        ? incomingEditsEntry[1]
        : draft.read<unknown>('gc.content.userEdits', undefined);
      const postImportPacks = validatedStoredPacks(
        postImportPacksRaw,
        incomingPacksEntry ? 'Imported value' : 'Stored value',
      );
      const postImportEdits = validatedUserEditsPack(
        postImportEditsRaw,
        incomingEditsEntry ? 'Imported value' : 'Stored value',
      );
      const exactTemplateIds = resolvePostImportCharacterTemplateIds(
        bundledContentPacks,
        incomingPacksEntry
          ? postImportPacks
          : postImportPacks.map(stored => ({
              ...stored,
              pack: preserveRequiredFallbackCharacter(stored.pack),
            })),
        incomingEditsEntry || postImportEdits === undefined
          ? postImportEdits
          : preserveRequiredFallbackCharacter(postImportEdits),
      );
      validationContext = { builtInCharacterIds: exactTemplateIds };
      if (
        needsRosterResolution
        && !exactTemplateIds.has(FALLBACK_CHARACTER_ID)
      ) {
        throw new Error(
          `Imported content must preserve fallback character ${JSON.stringify(FALLBACK_CHARACTER_ID)} so the roster cannot become orphaned.`,
        );
      }
    }
    for (const [key, incoming] of importable) {
      validatePortableStorageValue(key, incoming, 'Imported value', validationContext);
    }

    let mergedCustom: Record<string, unknown> | null = null;
    if (importsContentLayer || incomingCustomEntry || activeEntry) {
      const existingCustom = validateCustomCharacterMap(
        draft.read<Record<string, unknown>>('gc.customChars', {}),
        'Stored value',
        validationContext,
      );
      const incomingCustom = incomingCustomEntry
        ? validateCustomCharacterMap(incomingCustomEntry[1], 'Imported value', validationContext)
        : {};
      mergedCustom = Object.assign(
        Object.create(null) as Record<string, unknown>,
        existingCustom,
        incomingCustom,
      );
    }
    const postImportActive = activeEntry
      ? activeEntry[1]
      : importsContentLayer
        ? draft.read<unknown>('gc.activeCharId', FALLBACK_CHARACTER_ID)
        : undefined;
    if (postImportActive !== undefined) {
      validatePortableStorageValue(
        'gc.activeCharId',
        postImportActive,
        activeEntry ? 'Imported value' : 'Stored value',
        validationContext,
      );
      const activeId = postImportActive as string;
      const isTemplate = validationContext.builtInCharacterIds?.has(activeId) ?? false;
      const isCustom = mergedCustom !== null
        && Object.prototype.hasOwnProperty.call(mergedCustom, activeId);
      if (!isTemplate && !isCustom) {
        throw new Error(
          `Imported active character ${JSON.stringify(activeId)} does not exist in the post-import roster.`,
        );
      }
    }

    const keys: string[] = [];
    for (const [key, incoming] of importable) {
      if (key === 'gc.customChars') {
        draft.set(key, mergedCustom ?? incoming);
      } else {
        draft.set(key, incoming);
      }
      keys.push(key);
    }
    return { requested: keys.length, keys };
  });
}

/** Remove every app key as one journaled transaction. */
export function wipeGrimCompanionStorage(
  core: StorageCore = browserStorageCore,
): StorageMaintenanceTicket<number> {
  return core.clearMatching((key) => (
    key.startsWith('gc.')
    && key !== STORAGE_TRANSACTION_JOURNAL_KEY
    && key !== STORAGE_VERSION_KEY
    && key !== STORAGE_RECOVERY_RESET_INTENT_KEY
  ));
}
