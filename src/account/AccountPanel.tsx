import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useCharacter } from '../hooks/useCharacter';
import { useRoster } from '../hooks/useRoster';
import { useNativeStorageStatus } from '../storage/useNativeStorage';
import { applyNativeSettingsImport, buildNativeSettingsExport, validateNativeSettingsImport } from '../storage/settingsData';
import { colors, fontFamilies } from '../theme';
import type { AccountBackup } from './client';
import { nativeAccountClient as account } from './runtime';

type Action = 'session' | 'login' | 'register' | 'logout' | 'list' | 'save' | 'restore';

/** Optional online accounts; the device roster remains available while signed out. */
export const AccountPanel: React.FC = () => {
  const session = useSyncExternalStore(account.subscribe, account.getSnapshot, account.getSnapshot);
  const { id, template } = useCharacter();
  const { all } = useRoster();
  const storage = useNativeStorageStatus();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savedBackups, setSavedBackups] = useState<{ userId: string | null; items: readonly AccountBackup[] }>({ userId: null, items: [] });
  const backups = savedBackups.userId === session.user?.id ? savedBackups.items : [];
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const storageUnavailable = storage.pending > 0 || storage.dirty || storage.blocked;

  const run = useCallback(async (action: Action, work: () => Promise<void>) => {
    if (!mounted.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setError('');
    setMessage('');
    try { await work(); }
    catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The account action failed. Try again.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    if (!mounted.current) return;
    const version = account.sessionVersion;
    const userId = account.getSnapshot().user?.id ?? null;
    const list = await account.listBackups();
    if (mounted.current && version === account.sessionVersion) setSavedBackups({ userId, items: list });
  }, []);

  const checkSession = useCallback(() => run('session', async () => {
    await account.restoreSession();
    if (account.getSnapshot().user) await loadBackups();
  }), [run, loadBackups]);

  useEffect(() => {
    mounted.current = true;
    void checkSession();
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      const returning = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (returning && !busyRef.current) void checkSession();
    });
    return () => { mounted.current = false; subscription.remove(); };
  }, [checkSession]);

  const submit = () => { void run(mode, async () => {
    await account.authenticate(mode, { name, email, password });
    if (mounted.current) {
      setPassword('');
      setSavedBackups({ userId: null, items: [] });
      setMessage(mode === 'register' ? 'Account created. Your local characters are ready to back up.' : 'Signed in. Your local characters are ready to back up.');
    }
    await loadBackups();
  }); };

  const save = () => { void run('save', async () => {
    const version = account.sessionVersion;
    const snapshot = await buildNativeSettingsExport('roster', id, template.name);
    const dump = JSON.parse(snapshot) as Record<string, unknown>;
    if (!mounted.current) return;
    if (!Object.keys(dump).some(key => key.startsWith('gc.'))) {
      throw new Error('There is no saved roster data to back up yet. Make a character change, then try again.');
    }
    account.assertSession(version);
    const backup = await account.saveBackup(snapshot);
    if (mounted.current) {
      account.assertSession(version);
      const userId = account.getSnapshot().user!.id;
      setSavedBackups(previous => ({
        userId,
        items: [backup, ...(previous.userId === userId ? previous.items : []).filter(item => item.id !== backup.id)].slice(0, 10),
      }));
      setMessage('Roster backup saved to your account.');
    }
  }); };

  const restore = (backup: AccountBackup) => {
    if (!mounted.current || busyRef.current) return;
    const version = account.sessionVersion;
    Alert.alert(
      'Restore account backup?',
      `Restore the backup from ${new Date(backup.createdAt).toLocaleString()}? Matching local values will be replaced and custom characters will be merged. Other local data stays on this device. Save a current backup first if you need it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => { void run('restore', async () => {
          account.assertSession(version);
          const { snapshot } = await account.getBackup(backup.id);
          if (!mounted.current) return;
          let raw: unknown;
          try { raw = JSON.parse(snapshot) as unknown; }
          catch { throw new Error('This backup is not valid JSON. Local data was not changed.'); }
          const validated = validateNativeSettingsImport(raw, { availableCharacterIds: new Set(Object.keys(all)) });
          if (!validated.ok) throw new Error(validated.message);
          account.assertSession(version);
          const { result, written } = await applyNativeSettingsImport(validated.dump);
          if (!result.ok) throw new Error(`Restore was not confirmed: ${result.error.message}`);
          if (mounted.current) setMessage(`Backup restored. ${written} saved values were applied to this device.`);
        }); } },
      ],
    );
  };

  return (
    <Card style={{ marginTop: 20 }}>
      <Text style={styles.heading}>Account & backups</Text>
      <Text style={styles.body}>
        Sign in to keep private roster backups in your account. Your local characters stay on this device when you sign out. Backups are saved and restored only when you choose.
      </Text>

      {!account.configured ? (
        <Text style={styles.notice}>Accounts are unavailable in this build because the account server has not been configured. Local saves remain available.</Text>
      ) : session.user ? (
        <View style={styles.section}>
          <Text style={styles.title}>{session.user.name}</Text>
          <Text selectable style={styles.body}>{session.user.email}</Text>
          <View style={styles.actions}>
            <Button variant="primary" disabled={!!busy || storageUnavailable} onPress={save}>{busy === 'save' ? 'Saving…' : 'Save roster backup'}</Button>
            <Button variant="ghost" disabled={!!busy} onPress={() => { void run('logout', async () => {
              await account.logout();
              if (mounted.current) { setSavedBackups({ userId: null, items: [] }); setPassword(''); setMessage('Signed out. Local characters remain on this device.'); }
            }); }}>Sign out</Button>
          </View>
          <View style={styles.listHeading}>
            <Text style={styles.title}>Saved backups</Text>
            <Button variant="ghost" disabled={!!busy} onPress={() => { void run('list', loadBackups); }}>Refresh</Button>
          </View>
          <Text style={styles.body}>Your newest 10 backups are kept. Restore replaces matching local values.</Text>
          {backups.length === 0 ? <Text style={styles.body}>{busy ? 'Checking your backups…' : 'No backups saved yet.'}</Text> : backups.map(backup => (
            <View style={styles.backup} key={backup.id}>
              <View style={styles.backupLabel}>
                <Text style={styles.title}>{new Date(backup.createdAt).toLocaleString()}</Text>
                <Text style={styles.body}>{Math.max(1, Math.ceil(backup.bytes / 1024))} KiB · Roster</Text>
              </View>
              <Button disabled={!!busy || storageUnavailable} onPress={() => restore(backup)}>Restore</Button>
            </View>
          ))}
          {storageUnavailable ? <Text style={styles.notice}>Finish local saving or resolve the save status before saving or restoring a backup.</Text> : null}
        </View>
      ) : (
        <View style={styles.section}>
          <View style={styles.actions}>
            <Button variant={mode === 'login' ? 'primary' : 'ghost'} disabled={!!busy} onPress={() => { setMode('login'); setPassword(''); setError(''); }}>Sign in</Button>
            <Button variant={mode === 'register' ? 'primary' : 'ghost'} disabled={!!busy} onPress={() => { setMode('register'); setPassword(''); setError(''); }}>Create account</Button>
          </View>
          {mode === 'register' ? <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput accessibilityLabel="Account name" style={styles.input} value={name} onChangeText={setName} maxLength={80} editable={!busy} autoComplete="name" textContentType="name" placeholder="Your name" placeholderTextColor={colors.ink3} />
          </View> : null}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput accessibilityLabel="Account email" style={styles.input} value={email} onChangeText={setEmail} maxLength={254} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" placeholderTextColor={colors.ink3} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput accessibilityLabel="Account password" style={styles.input} value={password} onChangeText={setPassword} maxLength={128} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} textContentType={mode === 'register' ? 'newPassword' : 'password'} placeholder={mode === 'register' ? '12–128 characters' : 'Your password'} placeholderTextColor={colors.ink3} returnKeyType="go" onSubmitEditing={submit} />
          </View>
          <Button variant="primary" disabled={!!busy} onPress={submit}>{busy === 'login' || busy === 'register' ? 'Signing in…' : mode === 'register' ? 'Create account' : 'Sign in'}</Button>
        </View>
      )}
      {busy ? <View style={styles.progress}><ActivityIndicator color={colors.brass} size="small" /><Text style={styles.body}>{busy === 'restore' ? 'Restoring backup…' : busy === 'session' ? 'Checking your session…' : 'Contacting your account…'}</Text></View> : null}
      {error ? <View style={styles.section}>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        {!session.user && account.configured ? <Button variant="ghost" disabled={!!busy} onPress={() => { void checkSession(); }}>Retry connection</Button> : null}
      </View> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  heading: { fontFamily: fontFamilies.display, fontSize: 22, color: colors.ink, marginBottom: 6 },
  body: { fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, color: colors.ink3 },
  title: { fontFamily: fontFamilies.bodySemibold, fontSize: 13, color: colors.ink },
  section: { gap: 12, marginTop: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  field: { gap: 5, maxWidth: 440, width: '100%' },
  label: { fontFamily: fontFamilies.bodyMedium, fontSize: 12, color: colors.ink2 },
  input: { fontFamily: fontFamilies.body, fontSize: 14, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.ivory, color: colors.ink },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 },
  backup: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 },
  backupLabel: { flex: 1, gap: 4 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  notice: { fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, color: colors.ink2, marginTop: 12 },
  error: { fontFamily: fontFamilies.bodyMedium, fontSize: 12, lineHeight: 18, color: colors.empire },
  success: { fontFamily: fontFamilies.bodyMedium, fontSize: 12, lineHeight: 18, color: colors.success, marginTop: 12 },
});
