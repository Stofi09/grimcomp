import React, { useMemo, useRef, useState } from 'react';
import {
  MAX_SETTINGS_BACKUP_FILE_BYTES,
  SETTINGS_BACKUP_FILE_LIMIT_LABEL,
  SETTINGS_BACKUP_SCHEMA,
} from '@grimcomp/core';
import { ScreenContainer } from './ScreenContainer';
import { useContentPacks } from '@/content/useContentPacks';
import { useContent, useContentStatus } from '@/content/useContent';
import { validatePack } from '@/content/validate';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { EditSheet } from '@/components/EditSheet';
import { useXpRule } from '@/hooks/useSettings';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import { useStoragePersistenceStatus } from '@/hooks/useStoredState';
import {
  applySettingsImport,
  buildSettingsExport,
  wipeGrimCompanionStorage,
  type ExportScope,
} from '@/utils/settingsExport';
import { Alert } from '@/ui/alertStore';
import { colors } from '@/theme';
import './SettingsScreen.css';

/** Bound memory use before File.text() with the shared portable-backup cap. */
export const MAX_SETTINGS_IMPORT_FILE_BYTES = MAX_SETTINGS_BACKUP_FILE_BYTES;

interface RowProps {
  title: string;
  hint: string;
  value?: string;
  /** Optional right-side action — if omitted the row is read-only. */
  right?: React.ReactNode;
  last?: boolean;
}

const Row: React.FC<RowProps> = ({ title, hint, value, right, last }) => (
  <div className={`set-row${!last ? ' set-row-border' : ''}`}>
    <div className="set-row-main">
      <span className="set-title">{title}</span>
      <span className="set-body">{hint}</span>
    </div>
    {value != null ? <span className="set-value">{value}</span> : null}
    {right}
  </div>
);

export const SettingsScreen: React.FC = () => {
  const [xpRule, setXpRule] = useXpRule();
  const { id, template } = useCharacter();
  const { all } = useRoster();
  const content = useContent();
  const { packs: userPacks, add: addPack, remove: removePack, setEnabled } = useContentPacks();
  const { errors: contentErrors } = useContentStatus();
  const [exportSheet, setExportSheet] = useState<{ scope: ExportScope; json: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const storageStatus = useStoragePersistenceStatus();

  const packFileRef = useRef<HTMLInputElement>(null);
  const charFileRef = useRef<HTMLInputElement>(null);
  const coreVersion = content.packs.find(pack => pack.id === 'core-rules')?.version ?? 'Unknown';
  const builtInCharacterIds = useMemo(
    () => new Set(content.allCharacterTemplates.map(character => character.id)),
    [content],
  );

  const fileWithinImportLimit = (file: File): boolean => {
    if (file.size <= MAX_SETTINGS_IMPORT_FILE_BYTES) return true;
    Alert.alert(
      'Import too large',
      `${file.name} is larger than the ${SETTINGS_BACKUP_FILE_LIMIT_LABEL} import limit.`,
    );
    return false;
  };

  // Build a portable JSON snapshot. Caller chooses just the active character
  // and overlays, or the roster plus portable global state/content. Internal
  // storage keys and platform-local creation progress are intentionally omitted.
  const openExport = async (scope: ExportScope) => {
    try {
      const json = await buildSettingsExport(scope, id, template.name, {
        builtInCharacterIds,
        bundledContentPacks: content.bundledPacks,
      });
      setExportSheet({ scope, json });
    } catch (error) {
      Alert.alert(
        'Export failed',
        `Local data could not be read. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // Replaces RN's Share.share — trigger a real file download via a Blob URL.
  const download = () => {
    if (!exportSheet) return;
    const filename = exportSheet.scope === 'character'
      ? `grimcomp-${template.name.replace(/\s+/g, '-').toLowerCase() || 'character'}.json`
      : 'grimcomp-roster.json';
    try {
      const blob = new Blob([exportSheet.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
    }
    setExportSheet(null);
  };

  const wipeAll = () => {
    Alert.alert(
      'Wipe all local data?',
      'This deletes every character\'s wounds, XP, skill advances, conditions, talents, criticals, notes, and the active-character pointer. Built-in templates and the internal storage-format marker remain. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: async () => {
            const ticket = wipeGrimCompanionStorage();
            const result = await ticket.completion;
            if (!result.ok) {
              Alert.alert(
                result.outcome === 'blocked' ? 'Reset blocked' : 'Reset failed safely',
                `${result.error.message} No reset was reported complete; reload to retry recovery if needed.`,
              );
              return;
            }
            Alert.alert(
              'Local data reset',
              `${result.metadata} stored keys were removed durably. Reload to start fresh.`,
              [{ text: 'Reload', onPress: () => window.location.reload() }],
            );
          },
        },
      ],
    );
  };

  // --- Content-pack import (file + paste) -----------------------------------

  const handlePackImport = async (text: string, label: string): Promise<boolean> => {
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (e) {
      Alert.alert('Invalid JSON', `${label} is not valid JSON.\n${e instanceof Error ? e.message : ''}`);
      return false;
    }
    const { pack, errors, warnings } = validatePack(raw);
    if (errors.length > 0 || !pack) {
      Alert.alert(
        'Invalid content pack',
        errors.slice(0, 20).join('\n').slice(0, 800) || 'Unknown validation error.',
      );
      return false;
    }
    const persistence = await addPack(pack, content.bundledPacks).completion;
    if (!persistence.ok) {
      Alert.alert(
        persistence.outcome === 'blocked' ? 'Pack import blocked' : 'Pack import failed safely',
        `${persistence.error.message} The pack was not reported active.`,
      );
      return false;
    }
    // Surface non-fatal warnings (e.g. a mistyped section name that was silently
    // dropped) so a partial import isn't reported as an unqualified success.
    const warnNote = warnings.length > 0
      ? `\n\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:\n${warnings.slice(0, 20).join('\n')}`.slice(0, 800)
      : '';
    Alert.alert('Pack imported', `"${pack.name}" (${pack.id}) is now active.${warnNote}`);
    return true;
  };

  const onPackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    if (!fileWithinImportLimit(file)) return;
    try {
      const text = await file.text();
      await handlePackImport(text, file.name);
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : String(err));
    }
  };

  const submitPaste = async () => {
    if (new Blob([pasteText]).size > MAX_SETTINGS_IMPORT_FILE_BYTES) {
      Alert.alert(
        'Import too large',
        `Pasted JSON is larger than the ${(MAX_SETTINGS_IMPORT_FILE_BYTES / (1024 * 1024)).toFixed(0)} MiB import limit.`,
      );
      return;
    }
    if (await handlePackImport(pasteText, 'pasted JSON')) {
      setPasteOpen(false);
      setPasteText('');
    }
  };

  const updatePackEnabled = async (packId: string, enabled: boolean) => {
    const result = await setEnabled(packId, enabled, content.bundledPacks).completion;
    if (!result.ok) {
      Alert.alert(
        result.outcome === 'blocked' ? 'Pack change blocked' : 'Pack change failed safely',
        `${result.error.message} The content-pack change was not reported complete.`,
      );
    }
  };

  const deletePack = async (packId: string) => {
    const result = await removePack(packId, content.bundledPacks).completion;
    if (!result.ok) {
      Alert.alert(
        result.outcome === 'blocked' ? 'Pack removal blocked' : 'Pack removal failed safely',
        `${result.error.message} The content pack was not reported removed.`,
      );
    }
  };

  // --- Character / roster import (grimcomp.v1 export) ------------------------

  const applyImportDump = async (dump: Record<string, unknown>) => {
    const ticket = applySettingsImport(dump, {
      builtInCharacterIds,
      bundledContentPacks: content.bundledPacks,
    });
    const result = await ticket.completion;
    if (!result.ok) {
      Alert.alert(
        result.outcome === 'blocked' ? 'Import blocked' : 'Import failed safely',
        `${result.error.message} The import was not published as complete.`,
      );
      return;
    }
    Alert.alert(
      'Import complete',
      `${ticket.value.requested} keys committed durably. Reload to apply the imported data.`,
      [{ text: 'Reload', onPress: () => window.location.reload() }],
    );
  };

  const onCharFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!fileWithinImportLimit(file)) return;
    let raw: unknown;
    try {
      const text = await file.text();
      raw = JSON.parse(text);
    } catch (err) {
      Alert.alert('Invalid JSON', `${file.name} is not valid JSON.\n${err instanceof Error ? err.message : ''}`);
      return;
    }
    if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).$schema !== SETTINGS_BACKUP_SCHEMA) {
      Alert.alert('Not a Grim Companion export', `Expected a "grimcomp.v1" export file.`);
      return;
    }
    const dump = raw as Record<string, unknown>;
    const keyCount = Object.keys(dump).filter(k => (
      k.startsWith('gc.') && k !== 'gc.storage.transaction' && k !== 'gc.storageVersion'
    )).length;
    const who = typeof dump.character === 'string' ? dump.character : (dump.scope === 'roster' ? 'the full roster' : 'this export');
    Alert.alert(
      'Import data?',
      `This overwrites local data for ${who} with ${keyCount} keys from ${file.name}. Existing values for those keys are replaced. A reload follows.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', style: 'destructive', onPress: () => { void applyImportDump(dump); } },
      ],
    );
  };

  const rosterCount = Object.keys(all).length;

  return (
    <ScreenContainer>
      <Hero
        title="Settings"
        subRow={<span className="set-sub">All data is stored on this device. Rulebook data is available offline.</span>}
      />

      {/* hidden file inputs driven by the buttons below */}
      <input
        ref={packFileRef}
        type="file"
        accept="application/json,.json"
        className="set-file-input"
        onChange={onPackFile}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={charFileRef}
        type="file"
        accept="application/json,.json"
        className="set-file-input"
        onChange={onCharFile}
        aria-hidden="true"
        tabIndex={-1}
      />

      <Card flush style={{ marginTop: 20 }}>
        <Row
          title="Local storage"
          hint={storageStatus.lastError?.message ?? 'Journal recovery completed before the app opened.'}
          value={storageStatus.blocked
            ? 'Blocked'
            : storageStatus.pending > 0
              ? 'Saving…'
              : storageStatus.dirty
                ? 'Needs recovery'
                : 'Saved'}
        />

        {/* XP rule toggle — actually used by useXp.spend */}
        <Row
          title="XP rule"
          hint="Strict refuses purchases you can't afford. Flexible lets you overspend (GM trust mode)."
          value={xpRule === 'strict' ? 'Strict (refuse overdraft)' : 'Flexible (allow overdraft)'}
          right={
            <div className="set-actions" role="group" aria-label="XP rule">
              <button
                type="button"
                className={`btn-reset set-pill-btn${xpRule === 'strict' ? ' set-pill-btn--on' : ''}`}
                onClick={() => setXpRule('strict')}
                aria-pressed={xpRule === 'strict'}
              >
                <span className="set-pill-btn-text">Strict</span>
              </button>
              <button
                type="button"
                className={`btn-reset set-pill-btn${xpRule === 'flexible' ? ' set-pill-btn--on' : ''}`}
                onClick={() => setXpRule('flexible')}
                aria-pressed={xpRule === 'flexible'}
              >
                <span className="set-pill-btn-text">Flexible</span>
              </button>
            </div>
          }
        />

        <Row
          title="Active character"
          hint="Switch in the Characters screen, or create a new one."
          value={template.name}
        />

        <Row
          title="Roster"
          hint="Built-in templates + characters you've created."
          value={`${rosterCount} characters`}
        />

        <Row
          title="Language"
          hint="English. Hungarian translation is planned (the original mock was Hungarian)."
          value="English"
        />

        <Row
          title="Theme"
          hint="Parchment light theme. Dark theme is planned."
          value="Parchment"
        />

        <Row
          title="Rules library"
          hint={`Loaded core and supplement references used for spells, prayers, and rules tables. Core data version ${coreVersion}.`}
          value={`${content.packs.length} content layer${content.packs.length === 1 ? '' : 's'}`}
        />

        <Row
          title="Export"
          hint="Download the active character (without global notes/settings) or the entire roster + overlays."
          value="JSON"
          right={
            <div className="set-actions">
              <Button variant="ghost" onPress={() => { void openExport('character'); }}>This char</Button>
              <Button variant="ghost" onPress={() => { void openExport('roster'); }}>All</Button>
            </div>
          }
        />

        <Row
          title="Import data"
          hint="Load a grimcomp.v1 export file. Overwrites matching keys, then reloads."
          value="JSON"
          right={
            <Button variant="ghost" onPress={() => charFileRef.current?.click()}>Import file</Button>
          }
        />

        <Row
          title="Reset local data"
          hint="Removes user data, preserves the internal storage-format marker, then reloads. Use this to start over."
          value="Destructive"
          last
          right={
            <Button variant="ghost" textStyle={{ color: colors.empire }} onPress={wipeAll}>
              Wipe
            </Button>
          }
        />
      </Card>

      <Card flush style={{ marginTop: 20 }}>
        <div className="set-row">
          <div className="set-row-main">
            <span className="set-title">Content packs</span>
            <span className="set-body">
              Import JSON packs of homebrew spells, prayers, races, etc. Packs override bundled content by id.
            </span>
          </div>
          <div className="set-actions">
            <Button variant="ghost" onPress={() => packFileRef.current?.click()}>Import</Button>
            <Button variant="ghost" onPress={() => setPasteOpen(true)}>Paste JSON</Button>
          </div>
        </div>

        {userPacks.length === 0 ? (
          <div className="set-row set-pack-divider">
            <span className="set-body">No imported packs.</span>
          </div>
        ) : (
          userPacks.map(p => (
            <div key={p.pack.id} className="set-row set-pack-divider">
              <div className="set-row-main">
                <span className="set-title">{p.pack.name}</span>
                <span className="set-body">{p.pack.id} · v{p.pack.version}</span>
              </div>
              <button
                type="button"
                className={`btn-reset set-pill-btn${p.enabled ? ' set-pill-btn--on' : ''}`}
                onClick={() => { void updatePackEnabled(p.pack.id, !p.enabled); }}
              >
                <span className="set-pill-btn-text">{p.enabled ? 'Enabled' : 'Disabled'}</span>
              </button>
              <Button
                variant="ghost"
                textStyle={{ color: colors.empire }}
                onPress={() => { void deletePack(p.pack.id); }}
              >
                Remove
              </Button>
            </div>
          ))
        )}

        {/* surface bundled-pack load failures so users can debug bad JSON */}
        {contentErrors.length > 0 ? (
          <div className="set-error-row">
            <span className="set-title">Content failed to load</span>
            {contentErrors.map((err, i) => (
              <span key={i} className="set-error-text">{err}</span>
            ))}
          </div>
        ) : null}
      </Card>

      <EditSheet
        visible={!!exportSheet}
        title={exportSheet?.scope === 'character' ? `Export ${template.name}` : 'Export full roster'}
        subtitle={exportSheet
          ? `${exportSheet.json.length.toLocaleString()} bytes · ${exportSheet.json.split('\n').length} lines`
          : ''}
        onClose={() => setExportSheet(null)}
        onSave={download}
        saveLabel="Download"
      >
        {exportSheet ? (
          <div className="set-export-preview">
            <Pill variant="brass" size={10}>JSON · grimcomp.v1</Pill>
            <pre className="set-export-text">
              {exportSheet.json.length > 4000
                ? exportSheet.json.slice(0, 4000) + '\n\n…(truncated for preview — full JSON in the download)'
                : exportSheet.json}
            </pre>
          </div>
        ) : null}
      </EditSheet>

      <EditSheet
        visible={pasteOpen}
        title="Paste content pack JSON"
        subtitle="Paste a ContentPack JSON object. It will be validated before installing."
        onClose={() => { setPasteOpen(false); setPasteText(''); }}
        onSave={submitPaste}
        saveLabel="Install"
      >
        <textarea
          className="set-paste-input"
          aria-label="Content pack JSON"
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder='{ "$schema": "grimcomp.content.v2", ... }'
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </EditSheet>
    </ScreenContainer>
  );
};
