import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Button } from '@/components/Button';
import { useContent } from '@/content/useContent';
import { useCharacter } from '@/hooks/useCharacter';
import { applySettingsImport, buildSettingsExport } from '@/utils/settingsExport';
import { Alert } from '@/ui/alertStore';
import { accountApi, AccountApiError, type AccountUser, type BackupMetadata } from './api';
import { parseBackupSnapshot } from './backupSnapshot';
import './AccountPanel.css';

type Action = 'login' | 'register' | 'logout' | 'save' | 'restore';

export function AccountPanel() {
  const content = useContent();
  const { id, template } = useCharacter();
  const validationContext = useMemo(() => ({
    builtInCharacterIds: new Set(content.allCharacterTemplates.map(character => character.id)),
    bundledContentPacks: content.bundledPacks,
  }), [content]);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const mounted = useRef(false);
  const action = useRef<Action | null>(null);
  const sessionRevision = useRef(0);
  const accountRevision = useRef(0);
  const backupListRevision = useRef(0);
  const currentUser = useRef<AccountUser | null>(null);

  const updateUser = useCallback((next: AccountUser | null) => {
    if (currentUser.current?.id !== next?.id) {
      accountRevision.current += 1;
      backupListRevision.current += 1;
      setBackups([]);
      setNotice(null);
    }
    currentUser.current = next;
    setUser(next);
  }, []);

  const reportError = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    if (cause instanceof AccountApiError && (cause.status === 401 || cause.status === 409)) {
      sessionRevision.current += 1;
      updateUser(null);
      setChecking(false);
    }
    setError(cause instanceof Error ? cause.message : 'The account request failed. Please try again.');
  }, [updateUser]);

  const refreshSession = useCallback(async () => {
    if (!mounted.current || action.current !== null) return;
    const revision = ++sessionRevision.current;
    // A list started with the previous cookie session must not override this check.
    backupListRevision.current += 1;
    setChecking(true);
    try {
      const session = await accountApi.session();
      if (!mounted.current || revision !== sessionRevision.current) return;
      updateUser(session.user);
      setError(null);
      setListAttempt(value => value + 1);
    } catch (cause) {
      if (mounted.current && revision === sessionRevision.current) {
        setLoadingBackups(false);
        reportError(cause);
      }
    } finally {
      if (mounted.current && revision === sessionRevision.current) setChecking(false);
    }
  }, [reportError, updateUser]);

  useEffect(() => {
    mounted.current = true;
    void refreshSession();
    const onFocus = () => { void refreshSession(); };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      sessionRevision.current += 1;
      backupListRevision.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSession]);

  const accountId = user?.id;
  useEffect(() => {
    if (!accountId) {
      setLoadingBackups(false);
      return;
    }
    let active = true;
    const revision = ++backupListRevision.current;
    const isCurrent = () => active && mounted.current && revision === backupListRevision.current
      && currentUser.current?.id === accountId;
    setLoadingBackups(true);
    accountApi.listBackups(accountId).then(result => {
      if (isCurrent()) setBackups(result);
    }).catch(cause => {
      if (isCurrent()) reportError(cause);
    }).finally(() => {
      if (isCurrent()) setLoadingBackups(false);
    });
    return () => { active = false; };
  }, [accountId, listAttempt, reportError]);

  const runAction = async (kind: Action, perform: (revision: number) => Promise<void>) => {
    // A ref closes the gap before React publishes the disabled button state.
    if (!mounted.current || action.current !== null) return;
    action.current = kind;
    const revision = ++sessionRevision.current;
    setChecking(false);
    setBusy(kind);
    setError(null);
    setNotice(null);
    try { await perform(revision); }
    catch (cause) { reportError(cause); }
    finally {
      action.current = null;
      if (mounted.current) setBusy(null);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (checking || action.current !== null) return;
    if (!email.trim() || !password || (mode === 'register' && !name.trim())) {
      setError('Please fill in each account field.');
      return;
    }
    if (mode === 'register' && (password.length < 12 || password.length > 128)) {
      setError('Choose a password between 12 and 128 characters.');
      return;
    }
    void runAction(mode, async () => {
      const session = mode === 'register'
        ? await accountApi.register(name.trim(), email.trim(), password)
        : await accountApi.login(email.trim(), password);
      if (!mounted.current) return;
      updateUser(session.user);
      setPassword('');
      setNotice(mode === 'register' ? 'Account created. Your local data stays on this device.' : 'Logged in. Your local data stays on this device.');
    });
  };

  const logout = () => {
    void runAction('logout', async () => {
      await accountApi.logout();
      if (!mounted.current) return;
      updateUser(null);
      setPassword('');
      setNotice('Logged out. Your characters and settings remain on this device.');
    });
  };

  const saveBackup = () => {
    const expectedUserId = currentUser.current?.id;
    if (!expectedUserId) return;
    void runAction('save', async revision => {
      const snapshot = await buildSettingsExport('roster', id, template.name, validationContext);
      parseBackupSnapshot(snapshot);
      if (!mounted.current || revision !== sessionRevision.current || currentUser.current?.id !== expectedUserId) return;
      const backup = await accountApi.saveBackup(snapshot, expectedUserId);
      if (!mounted.current || revision !== sessionRevision.current || currentUser.current?.id !== expectedUserId) return;
      setBackups(previous => [backup, ...previous.filter(item => item.id !== backup.id)].slice(0, 10));
      setNotice('Backup saved to your account. The newest 10 backups are kept.');
    });
  };

  const confirmRestore = (backup: BackupMetadata) => {
    const accountId = user?.id;
    const confirmedAccountRevision = accountRevision.current;
    Alert.alert(
      'Restore account backup?',
      `Restore the backup from ${new Date(backup.createdAt).toLocaleString()}? This merges custom characters and replaces matching local data, including settings and content packs. Other local data stays. Save a backup of this device first if you want to keep its current values.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => {
          if (!accountId || currentUser.current?.id !== accountId
            || accountRevision.current !== confirmedAccountRevision) return;
          void runAction('restore', async revision => {
            const result = await accountApi.getBackup(backup.id, accountId);
            const dump = parseBackupSnapshot(result.snapshot);
            if (!mounted.current || revision !== sessionRevision.current || currentUser.current?.id !== accountId) return;
            const ticket = applySettingsImport(dump, validationContext);
            const persistence = await ticket.completion;
            if (!mounted.current || revision !== sessionRevision.current || currentUser.current?.id !== accountId) return;
            if (!persistence.ok) {
              throw new Error(`${persistence.error.message} Restore was not reported complete. Reload to retry recovery if needed.`);
            }
            setNotice('Backup restored and saved on this device. Reload to apply all imported data.');
            Alert.alert(
              'Backup restored',
              `${ticket.value.requested} keys saved durably on this device. Reload to apply the imported data.`,
              [{ text: 'Reload', onPress: () => window.location.reload() }],
            );
          });
        } },
      ],
    );
  };

  const disabled = checking || busy !== null;

  return (
    <section className="account-panel" aria-label="Account and private backups">
      <Card flush>
        <CardHead title="Account & private backups" meta="Optional" />
        <CardBody>
          <p className="account-copy">
            Characters and settings are stored on this device and work offline. Log in to save private
            backups and restore them on another device. Backups are only saved or restored when you choose;
            logging in or out keeps your local data.
          </p>
          {checking && <p className="account-copy" role="status">Checking your session…</p>}
          {error && (
            <div className="account-error" role="alert">
              <p>{error}</p>
              <Button variant="ghost" disabled={disabled} onPress={() => { void refreshSession(); }}>
                Retry connection
              </Button>
            </div>
          )}
          {notice && <p className="account-notice" role="status">{notice}</p>}
          {user ? (
            <>
              <div className="account-identity">
                <div><strong>{user.name}</strong><span className="account-copy">{user.email}</span></div>
                <Button variant="ghost" disabled={disabled} onPress={logout}>
                  {busy === 'logout' ? 'Logging out…' : 'Log out'}
                </Button>
              </div>
              <div className="account-backup-heading">
                <div>
                  <h3>Private backups</h3>
                  <p className="account-copy">Your entire saved roster, notes, settings and content. The newest 10 backups are kept.</p>
                </div>
                <Button variant="primary" disabled={disabled || loadingBackups} onPress={saveBackup}>
                  {busy === 'save' ? 'Saving backup…' : 'Save backup'}
                </Button>
              </div>
              {loadingBackups ? <p className="account-copy" role="status">Loading backups…</p>
                : backups.length === 0 ? <p className="account-copy">No account backups yet.</p>
                  : <ul className="account-backups">
                    {backups.map(backup => (
                      <li key={backup.id}>
                        <div>
                          <time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString()}</time>
                          <span className="account-copy">{(backup.bytes / 1024).toFixed(1)} KiB</span>
                        </div>
                        <Button variant="ghost" disabled={disabled} onPress={() => confirmRestore(backup)}
                          ariaLabel={`Restore backup from ${new Date(backup.createdAt).toLocaleString()}`}>
                          {busy === 'restore' ? 'Restoring…' : 'Restore'}
                        </Button>
                      </li>
                    ))}
                  </ul>}
            </>
          ) : (
            <>
              <div className="account-modes" role="group" aria-label="Account access">
                <Button variant={mode === 'login' ? 'brass' : 'ghost'} disabled={disabled}
                  onPress={() => { setMode('login'); setPassword(''); setError(null); }}>Log in</Button>
                <Button variant={mode === 'register' ? 'brass' : 'ghost'} disabled={disabled}
                  onPress={() => { setMode('register'); setPassword(''); setError(null); }}>Create account</Button>
              </div>
              <form className="account-form" aria-label={mode === 'register' ? 'Create account' : 'Log in'} onSubmit={submit}>
                {mode === 'register' && <label>
                  Name
                  <input name="name" autoComplete="name" required maxLength={80} value={name}
                    disabled={disabled} onChange={event => setName(event.target.value)} />
                </label>}
                <label>
                  Email
                  <input type="email" name="email" autoComplete="username" required maxLength={254} value={email}
                    disabled={disabled} onChange={event => setEmail(event.target.value)} />
                </label>
                <label>
                  Password
                  <input type="password" name="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    required minLength={mode === 'register' ? 12 : undefined} maxLength={128} value={password}
                    aria-describedby={mode === 'register' ? 'account-password-help' : undefined}
                    disabled={disabled} onChange={event => setPassword(event.target.value)} />
                </label>
                {mode === 'register' && <p className="account-copy" id="account-password-help">Use 12–128 characters for your password.</p>}
                <button type="submit" className="btn-reset gc-btn gc-btn--primary" disabled={disabled}>
                  <span className="gc-btn-text">{busy === 'register' ? 'Creating account…' : busy === 'login' ? 'Logging in…' : mode === 'register' ? 'Register' : 'Sign in'}</span>
                </button>
              </form>
            </>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
