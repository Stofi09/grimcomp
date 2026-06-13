import React, { useRef, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useContentPacks } from '@/content/useContentPacks';
import { useContentStatus } from '@/content/ContentProvider';
import { validatePack } from '@/content/validate';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { EditSheet } from '@/components/EditSheet';
import { useXpRule } from '@/hooks/useSettings';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import { Alert } from '@/ui/alert';
import { colors } from '@/theme';
import './SettingsScreen.css';

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

// Read every gc.* key straight out of localStorage. Mirrors the RN original's
// AsyncStorage.getAllKeys()/multiGet() but synchronous on the web.
function gcKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('gc.')) out.push(k);
    }
  } catch { /* privacy mode — nothing to export */ }
  return out;
}

export const SettingsScreen: React.FC = () => {
  const [xpRule, setXpRule] = useXpRule();
  const { id, template } = useCharacter();
  const { all, custom } = useRoster();
  const { packs: userPacks, add: addPack, remove: removePack, setEnabled } = useContentPacks();
  const { errors: contentErrors } = useContentStatus();
  const [exportSheet, setExportSheet] = useState<{ scope: 'character' | 'roster'; json: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const packFileRef = useRef<HTMLInputElement>(null);
  const charFileRef = useRef<HTMLInputElement>(null);

  // Build a portable JSON snapshot. Caller chooses: just the active character
  // template + their live overlays (gc.<id>.*), or the whole roster + all
  // overlays. We collect everything keyed under `gc.` to make import a
  // straightforward `setItem` loop later.
  const buildExport = (scope: 'character' | 'roster'): string => {
    const keys = gcKeys();
    const wanted = scope === 'character'
      ? keys.filter(k => k.startsWith(`gc.${id}.`) || k === 'gc.activeCharId')
      : keys;
    const dump: Record<string, unknown> = {
      $schema: 'grimcomp.v1',
      exportedAt: new Date().toISOString(),
      scope,
      character: scope === 'character' ? template.name : undefined,
    };
    for (const k of wanted) {
      const v = window.localStorage.getItem(k);
      if (v == null) continue;
      try { dump[k] = JSON.parse(v); }
      catch { dump[k] = v; }
    }
    // A custom character's *definition* lives in the roster-wide `gc.customChars`
    // map, not under `gc.<id>.*` — so a per-character export would omit it and the
    // character would resolve to a default template on import. Carry just this
    // character's entry (scoped so we don't leak the rest of the roster). Built-in
    // templates need no definition: they come from the content packs.
    if (scope === 'character' && custom[id]) {
      dump['gc.customChars'] = { [id]: custom[id] };
    }
    // Notes live in a single global store (gc.notes / gc.notes.filter), not
    // under gc.<id>.*. Carry them in a per-character export too — otherwise a
    // character re-imported onto a fresh device silently loses every note.
    if (scope === 'character') {
      for (const gk of ['gc.notes', 'gc.notes.filter']) {
        const v = window.localStorage.getItem(gk);
        if (v == null) continue;
        try { dump[gk] = JSON.parse(v); }
        catch { dump[gk] = v; }
      }
    }
    return JSON.stringify(dump, null, 2);
  };

  const openExport = (scope: 'character' | 'roster') => {
    setExportSheet({ scope, json: buildExport(scope) });
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
      'This deletes every character\'s wounds, XP, skill advances, conditions, talents, criticals, notes, and the active-character pointer. Built-in templates remain. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: () => {
            const keys = gcKeys();
            for (const k of keys) {
              try { window.localStorage.removeItem(k); } catch { /* ignore */ }
            }
            // Reload to drop all in-memory state and re-seed from templates.
            window.location.reload();
          },
        },
      ],
    );
  };

  // --- Content-pack import (file + paste) -----------------------------------

  const handlePackImport = (text: string, label: string) => {
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (e) {
      Alert.alert('Invalid JSON', `${label} is not valid JSON.\n${e instanceof Error ? e.message : ''}`);
      return;
    }
    const { pack, errors, warnings } = validatePack(raw);
    if (errors.length > 0 || !pack) {
      Alert.alert('Invalid content pack', errors.join('\n').slice(0, 800) || 'Unknown validation error.');
      return;
    }
    addPack(pack);
    // Surface non-fatal warnings (e.g. a mistyped section name that was silently
    // dropped) so a partial import isn't reported as an unqualified success.
    const warnNote = warnings.length > 0
      ? `\n\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:\n${warnings.join('\n')}`.slice(0, 800)
      : '';
    Alert.alert('Pack imported', `"${pack.name}" (${pack.id}) is now active.${warnNote}`);
  };

  const onPackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const text = await file.text();
      handlePackImport(text, file.name);
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : String(err));
    }
  };

  const submitPaste = () => {
    handlePackImport(pasteText, 'pasted JSON');
    setPasteOpen(false);
    setPasteText('');
  };

  // --- Character / roster import (grimcomp.v1 export) ------------------------

  const applyImportDump = (dump: Record<string, unknown>) => {
    let written = 0;
    const failed: string[] = [];
    for (const [k, v] of Object.entries(dump)) {
      if (!k.startsWith('gc.')) continue; // skip $schema / metadata keys
      try {
        if (k === 'gc.customChars') {
          // Merge the custom-character map instead of overwriting it, so importing
          // a single character (or another device's roster) never deletes customs
          // already on this device. Incoming entries win on id collision.
          let existing: Record<string, unknown> = {};
          try { existing = JSON.parse(window.localStorage.getItem(k) || '{}') || {}; }
          catch { existing = {}; }
          const incoming = (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
          window.localStorage.setItem(k, JSON.stringify({ ...existing, ...incoming }));
        } else {
          window.localStorage.setItem(k, JSON.stringify(v));
        }
        written += 1;
      } catch {
        // Quota exceeded / privacy mode / unserialisable — record so the user
        // is told the import was partial rather than silently dropping keys.
        failed.push(k);
      }
    }
    Alert.alert(
      failed.length > 0 ? 'Import incomplete' : 'Import complete',
      failed.length > 0
        ? `${written} keys written, ${failed.length} failed (likely storage quota or privacy mode):\n${failed.join(', ').slice(0, 400)}\n\nReloading to apply what was written…`
        : `${written} keys written. Reloading to apply the imported data…`,
      [{ text: 'OK', onPress: () => window.location.reload() }],
    );
  };

  const onCharFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let raw: unknown;
    try {
      const text = await file.text();
      raw = JSON.parse(text);
    } catch (err) {
      Alert.alert('Invalid JSON', `${file.name} is not valid JSON.\n${err instanceof Error ? err.message : ''}`);
      return;
    }
    if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).$schema !== 'grimcomp.v1') {
      Alert.alert('Not a Grim Companion export', `Expected a "grimcomp.v1" export file.`);
      return;
    }
    const dump = raw as Record<string, unknown>;
    const keyCount = Object.keys(dump).filter(k => k.startsWith('gc.')).length;
    const who = typeof dump.character === 'string' ? dump.character : (dump.scope === 'roster' ? 'the full roster' : 'this export');
    Alert.alert(
      'Import data?',
      `This overwrites local data for ${who} with ${keyCount} keys from ${file.name}. Existing values for those keys are replaced. A reload follows.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', style: 'destructive', onPress: () => applyImportDump(dump) },
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
        {/* XP rule toggle — actually used by useXp.spend */}
        <Row
          title="XP rule"
          hint="Strict refuses purchases you can't afford. Flexible lets you overspend (GM trust mode)."
          value={xpRule === 'strict' ? 'Strict (refuse overdraft)' : 'Flexible (allow overdraft)'}
          right={
            <div className="set-actions">
              <button
                type="button"
                className={`btn-reset set-pill-btn${xpRule === 'strict' ? ' set-pill-btn--on' : ''}`}
                onClick={() => setXpRule('strict')}
              >
                <span className="set-pill-btn-text">Strict</span>
              </button>
              <button
                type="button"
                className={`btn-reset set-pill-btn${xpRule === 'flexible' ? ' set-pill-btn--on' : ''}`}
                onClick={() => setXpRule('flexible')}
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
          title="Rulebook"
          hint="WFRP 4e core book references used for spells, prayers, and miscast tables."
          value="2026.04.01"
        />

        <Row
          title="Export"
          hint="Download a JSON snapshot of the active character or the entire roster + overlays."
          value="JSON"
          right={
            <div className="set-actions">
              <Button variant="ghost" onPress={() => openExport('character')}>This char</Button>
              <Button variant="ghost" onPress={() => openExport('roster')}>All</Button>
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
          hint="Removes every gc.* key from local storage, then reloads. Use this to start over."
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
              Import JSON packs of homebrew spells, prayers, races, etc. Packs override core content by id.
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
                onClick={() => setEnabled(p.pack.id, !p.enabled)}
              >
                <span className="set-pill-btn-text">{p.enabled ? 'Enabled' : 'Disabled'}</span>
              </button>
              <Button
                variant="ghost"
                textStyle={{ color: colors.empire }}
                onPress={() => removePack(p.pack.id)}
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
