import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Share, Pressable, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { colors, fontFamilies } from '@/theme';

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
  const [exportSheet, setExportSheet] = useState<{ scope: 'character' | 'roster'; json: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Build a portable JSON snapshot. Caller chooses: just the active character
  // template + their live overlays (gc.<id>.*), or the whole roster + all
  // overlays. We collect everything keyed under `gc.` to make import a
  // straightforward `setItem` loop later.
  const buildExport = async (scope: 'character' | 'roster'): Promise<string> => {
    const allKeys = await AsyncStorage.getAllKeys();
    const wanted = scope === 'character'
      ? allKeys.filter(k => k.startsWith(`gc.${id}.`) || k === 'gc.activeCharId')
      : allKeys.filter(k => k.startsWith('gc.'));
    const entries = await AsyncStorage.multiGet(wanted);
    const dump: Record<string, unknown> = {
      $schema: 'grimcomp.v1',
      exportedAt: new Date().toISOString(),
      scope,
      character: scope === 'character' ? template.name : undefined,
    };
    for (const [k, v] of entries) {
      if (v == null) continue;
      try { dump[k] = JSON.parse(v); }
      catch { dump[k] = v; }
    }
    return JSON.stringify(dump, null, 2);
  };

  const openExport = (scope: 'character' | 'roster') => {
    buildExport(scope).then(json => setExportSheet({ scope, json }));
  };

  const share = async () => {
    if (!exportSheet) return;
    try {
      await Share.share({
        message: exportSheet.json,
        title: exportSheet.scope === 'character' ? `${template.name} — Grim Companion export` : 'Grim Companion — full export',
      });
    } catch {
      /* user dismissed */
    }
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
          onPress: async () => {
            const keys = await AsyncStorage.getAllKeys();
            const gcKeys = keys.filter(k => k.startsWith('gc.'));
            await AsyncStorage.multiRemove(gcKeys);
            Alert.alert(
              'Wiped',
              `${gcKeys.length} keys removed. Reload the app to see the fresh state.`,
            );
          },
        },
      ],
    );
  };

  const handleImport = (text: string, label: string) => {
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (e) {
      Alert.alert('Invalid JSON', `${label} is not valid JSON.\n${e instanceof Error ? e.message : ''}`);
      return;
    }
    const { pack, errors } = validatePack(raw);
    if (errors.length > 0 || !pack) {
      Alert.alert('Invalid content pack', errors.join('\n').slice(0, 800) || 'Unknown validation error.');
      return;
    }
    addPack(pack);
    Alert.alert('Pack imported', `"${pack.name}" (${pack.id}) is now active.`);
  };

  const importPack = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const fileRes = await fetch(asset.uri);
      const text = await fileRes.text();
      handleImport(text, asset.name);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const submitPaste = () => {
    handleImport(pasteText, 'pasted JSON');
    setPasteOpen(false);
    setPasteText('');
  };

  const rosterCount = Object.keys(all).length;

  return (
    <ScreenContainer>
      <Hero
        title="Settings"
        subRow={<Text style={styles.sub}>All data is stored on this device. Rulebook data is available offline.</Text>}
      />

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
          title="Reset local data"
          hint="Removes every gc.* key from AsyncStorage. Use this to start over."
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
