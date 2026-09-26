import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Share, Pressable, TextInput } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenContainer } from './ScreenContainer';
import { useContentPacks } from '@/content/useContentPacks';
import { validatePack } from '@/content/validate';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { EditSheet } from '@/components/EditSheet';
import { useXpRule } from '@/hooks/useSettings';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import {
  applyNativeSettingsImport,
  buildNativeSettingsExport,
  resetNativeStorageData,
  validateNativeSettingsImport,
} from '@/storage/settingsData';
import {
  knownNativeImportSizeError,
  nativeImportTextSizeError,
  parseNativeImportContentLength,
} from '@/storage/nativeImportLimits';
import { useNativeStorageStatus } from '@/storage/useNativeStorage';
import { colors, fontFamilies } from '@/theme';
import { AccountPanel } from '@/account/AccountPanel';

interface RowProps {
  title: string;
  hint: string;
  value: string;
  /** Optional right-side action — if omitted the row is read-only. */
  right?: React.ReactNode;
  last?: boolean;
}

const Row: React.FC<RowProps> = ({ title, hint, value, right, last }) => (
  <View
    style={[
      styles.row,
      !last ? styles.rowBorder : null,
    ]}
  >
    <View style={{ flex: 1 }}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{hint}</Text>
    </View>
    <Text style={styles.value}>{value}</Text>
    {right}
  </View>
);

export const SettingsScreen: React.FC = () => {
  const [xpRule, setXpRule] = useXpRule();
  const { id, template } = useCharacter();
  const { all } = useRoster();
  const { packs: userPacks, add: addPack, remove: removePack, setEnabled } = useContentPacks();
  const storageStatus = useNativeStorageStatus();
  const [exportSheet, setExportSheet] = useState<{ scope: 'character' | 'roster'; json: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const readImportAsset = async (asset: DocumentPicker.DocumentPickerAsset): Promise<string | null> => {
    const assetError = knownNativeImportSizeError(asset.name, asset.size);
    if (assetError) {
      Alert.alert('Import too large', assetError);
      return null;
    }
    const response = await fetch(asset.uri);
    const responseError = knownNativeImportSizeError(
      asset.name,
      parseNativeImportContentLength(response.headers.get('content-length')),
    );
    if (responseError) {
      Alert.alert('Import too large', responseError);
      return null;
    }
    const text = await response.text();
    const textError = nativeImportTextSizeError(asset.name, text);
    if (textError) {
      Alert.alert('Import too large', textError);
      return null;
    }
    return text;
  };

  const openExport = async (scope: 'character' | 'roster') => {
    try {
      const json = await buildNativeSettingsExport(scope, id, template.name);
      setExportSheet({ scope, json });
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    }
  };

  const share = async () => {
    if (!exportSheet) return;
    try {
      await Share.share({
        message: exportSheet.json,
        title: exportSheet.scope === 'character' ? `${template.name} — Grim Companion export` : 'Grim Companion — full export',
      });
    } catch (error) {
      Alert.alert('Share failed', error instanceof Error ? error.message : String(error));
    }
  };

  const wipeAll = () => {
    Alert.alert(
      'Wipe all local data?',
      'This permanently deletes custom characters, every character overlay (wounds, XP, advances, conditions, talents, criticals, and equipment), notes, imported content packs, creation drafts, app settings, and the active-character pointer. Only templates bundled with the app remain. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: async () => {
            try {
              const { result, written } = await resetNativeStorageData();
              if (!result.ok) {
                Alert.alert('Reset not confirmed', `${result.error.message}\n\nStorage remains guarded. Restart before retrying if the save status needs attention.`);
                return;
              }
              Alert.alert('Wiped', `${written} data keys removed and live screens reset to their defaults.`);
            } catch (error) {
              Alert.alert('Reset not confirmed', error instanceof Error ? error.message : String(error));
            }
          },
        },
      ],
    );
  };

  const handleImport = async (text: string, label: string): Promise<boolean> => {
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (e) {
      Alert.alert('Invalid JSON', `${label} is not valid JSON.\n${e instanceof Error ? e.message : ''}`);
      return false;
    }
    const { pack, errors } = validatePack(raw);
    if (errors.length > 0 || !pack) {
      Alert.alert('Invalid content pack', errors.join('\n').slice(0, 800) || 'Unknown validation error.');
      return false;
    }
    const result = await addPack(pack);
    if (!result.ok) {
      Alert.alert('Import not confirmed', `${result.error.message}\n\nCheck the local save status before retrying.`);
      return false;
    }
    Alert.alert('Pack imported', `"${pack.name}" (${pack.id}) is now active.`);
    return true;
  };

  const importPack = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const text = await readImportAsset(asset);
      if (text === null) return;
      await handleImport(text, asset.name);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const submitPaste = async () => {
    const sizeError = nativeImportTextSizeError('Pasted JSON', pasteText);
    if (sizeError) {
      Alert.alert('Import too large', sizeError);
      return;
    }
    if (await handleImport(pasteText, 'pasted JSON')) {
      setPasteOpen(false);
      setPasteText('');
    }
  };

  const importData = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const text = await readImportAsset(asset);
      if (text === null) return;
      const raw: unknown = JSON.parse(text);
      const validated = validateNativeSettingsImport(raw, {
        availableCharacterIds: new Set(Object.keys(all)),
      });
      if (!validated.ok) {
        Alert.alert('Not a Grim Companion export', validated.message);
        return;
      }
      const who = typeof validated.dump.character === 'string'
        ? validated.dump.character
        : validated.dump.scope === 'roster' ? 'the full roster' : 'this export';
      Alert.alert(
        'Import data?',
        `This atomically replaces ${validated.keyCount} matching data keys for ${who}. Existing custom characters are merged.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            style: 'destructive',
            onPress: async () => {
              const { result, written } = await applyNativeSettingsImport(validated.dump);
              if (!result.ok) {
                Alert.alert('Import not confirmed', `${result.error.message}\n\nStorage remains guarded. Restart before retrying if the save status needs attention.`);
                return;
              }
              Alert.alert('Import complete', `${written} keys were durably applied.`);
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    }
  };

  const rosterCount = Object.keys(all).length;
  const storageValue = storageStatus.pending > 0
    ? `Saving (${storageStatus.pending})`
    : storageStatus.dirty ? 'Needs attention' : 'Saved';
  const storageHint = storageStatus.lastError
    ? `Last persistence issue: ${storageStatus.lastError.message}`
    : 'Changes are queued in order and verified in local storage before they are marked saved.';

  return (
    <ScreenContainer>
      <Hero
        title="Settings"
        subRow={<Text style={styles.sub}>Characters save on this device. Rulebook data is available offline.</Text>}
      />

      <AccountPanel />

      <Card flush style={{ marginTop: 20 }}>
        {/* XP rule toggle — actually used by useXp.spend */}
        <Row
          title="XP rule"
          hint="Strict refuses purchases you can't afford. Flexible lets you overspend (GM trust mode)."
          value={xpRule === 'strict' ? 'Strict (refuse overdraft)' : 'Flexible (allow overdraft)'}
          right={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable
                onPress={() => setXpRule('strict')}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.pillBtn,
                  xpRule === 'strict' && styles.pillBtnOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.pillBtnText, xpRule === 'strict' && styles.pillBtnTextOn]}>Strict</Text>
              </Pressable>
              <Pressable
                onPress={() => setXpRule('flexible')}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.pillBtn,
                  xpRule === 'flexible' && styles.pillBtnOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.pillBtnText, xpRule === 'flexible' && styles.pillBtnTextOn]}>Flexible</Text>
              </Pressable>
            </View>
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
          title="Local save status"
          hint={storageHint}
          value={storageValue}
        />

        <Row
          title="Export"
          hint="Copy a JSON snapshot of the active character or the entire roster + overlays."
          value="JSON"
          right={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Button variant="ghost" onPress={() => openExport('character')}>This char</Button>
              <Button variant="ghost" onPress={() => openExport('roster')}>All</Button>
            </View>
          }
        />

        <Row
          title="Import data"
          hint="Load a grimcomp.v1 character or roster export as one recoverable transaction."
          value="JSON"
          right={
            <Button variant="ghost" onPress={importData}>Import file</Button>
          }
        />

        <Row
          title="Reset local data"
          hint="Atomically removes all user data while preserving the validated storage format marker."
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
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Content packs</Text>
            <Text style={styles.body}>
              Import JSON packs of homebrew spells, prayers, races, etc. Packs override core content by id.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Button variant="ghost" onPress={importPack}>Import</Button>
            <Button variant="ghost" onPress={() => setPasteOpen(true)}>Paste JSON</Button>
          </View>
        </View>

        {userPacks.length === 0 ? (
          <View style={[styles.row, styles.packDivider]}>
            <Text style={styles.body}>No imported packs.</Text>
          </View>
        ) : (
          userPacks.map(p => (
            <View key={p.pack.id} style={[styles.row, styles.packDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{p.pack.name}</Text>
                <Text style={styles.body}>{p.pack.id} · v{p.pack.version}</Text>
              </View>
              <Pressable
                onPress={() => setEnabled(p.pack.id, !p.enabled)}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.pillBtn,
                  p.enabled && styles.pillBtnOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.pillBtnText, p.enabled && styles.pillBtnTextOn]}>
                  {p.enabled ? 'Enabled' : 'Disabled'}
                </Text>
              </Pressable>
              <Button
                variant="ghost"
                textStyle={{ color: colors.empire }}
                onPress={() => removePack(p.pack.id)}
              >
                Remove
              </Button>
            </View>
          ))
        )}
      </Card>

      <EditSheet
        visible={!!exportSheet}
        title={exportSheet?.scope === 'character' ? `Export ${template.name}` : 'Export full roster'}
        subtitle={exportSheet
          ? `${exportSheet.json.length.toLocaleString()} bytes · ${exportSheet.json.split('\n').length} lines`
          : ''}
        onClose={() => setExportSheet(null)}
        onSave={share}
        saveLabel="Share / copy"
      >
        {exportSheet ? (
          <View style={styles.exportPreview}>
            <Pill variant="brass" size={10}>JSON · grimcomp.v1</Pill>
            <Text style={styles.exportText} numberOfLines={40} selectable>
              {exportSheet.json.length > 4000
                ? exportSheet.json.slice(0, 4000) + '\n\n…(truncated for preview — full JSON copied via Share)'
                : exportSheet.json}
            </Text>
          </View>
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
        <TextInput
          multiline
          value={pasteText}
          onChangeText={setPasteText}
          placeholder='{ "$schema": "grimcomp.content.v1", ... }'
          placeholderTextColor={colors.ink4}
          style={styles.pasteInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </EditSheet>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  body: {
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
    lineHeight: 16,
  },
  value: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink2,
  },
  pillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  pillBtnOn: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  pillBtnText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 11.5,
    color: colors.ink2,
  },
  pillBtnTextOn: { color: colors.bone },
  exportPreview: { gap: 8 },
  exportText: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink2,
    lineHeight: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
    padding: 10,
  },
  packDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  pasteInput: {
    minHeight: 240,
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
    padding: 10,
    textAlignVertical: 'top',
  },
});
