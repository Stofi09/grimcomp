import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Button } from '@/components/Button';
import { useContent } from '@/content/useContent';
import { useCharacter } from '@/hooks/useCharacter';
import { applySettingsImport, buildSettingsExport } from '@/utils/settingsExport';
import { Alert } from '@/ui/alertStore';
import {
  accountApi, AccountApiError,
  type AccountSession, type AccountUser, type BackupMetadata, type RegistrationMode,
} from './api';
import { parseBackupSnapshot } from './backupSnapshot';
import './AccountPanel.css';

type Action = 'login' | 'register' | 'logout' | 'save' | 'restore'
  | 'changePassword' | 'logoutEverywhere' | 'deleteBackup' | 'deleteAccount';
type SecurityForm = 'password' | 'delete';
// `unknown`: the server could not say, so an invite code stays optional.
type Registration = RegistrationMode | 'unknown';

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
  const [inviteCode, setInviteCode] = useState('');
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [securityForm, setSecurityForm] = useState<SecurityForm | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const mounted = useRef(false);
  const action = useRef<Action | null>(null);
  const sessionRevision = useRef(0);
  const accountRevision = useRef(0);
  const backupListRevision = useRef(0);
  const currentUser = useRef<AccountUser | null>(null);

  const clearSecurityForm = useCallback(() => {
    setSecurityForm(null);
    setCurrentPassword('');
    setNewPassword('');
    setDeletePassword('');
  }, []);

  const updateUser = useCallback((next: AccountUser | null) => {
    if (currentUser.current?.id !== next?.id) {
      accountRevision.current += 1;
      backupListRevision.current += 1;
      setBackups([]);
      setNotice(null);
      // Passwords typed for one account never carry over to another.
      clearSecurityForm();
    }
    currentUser.current = next;
    setUser(next);
  }, [clearSecurityForm]);

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

  // Ask which sign-ups the server accepts only once someone opens the form.
  useEffect(() => {
    if (user || mode !== 'register' || registration !== null) return;
    let active = true;
    Promise.resolve().then(() => accountApi.registrationMode()).then(next => {
      if (active && mounted.current) setRegistration(next);
    }).catch(() => {
      if (active && mounted.current) setRegistration('unknown');
    });
    return () => { active = false; };
  }, [user, mode, registration]);

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
    const invite = inviteCode.trim();
    if (mode === 'register' && registration === 'invite' && !invite) {
      setError('Enter the invite code from the server owner.');
      return;
    }
    void runAction(mode, async () => {
      let session: AccountSession;
      try {
        session = mode === 'login'
          ? await accountApi.login(email.trim(), password)
          : invite
            ? await accountApi.register(name.trim(), email.trim(), password, invite)
            : await accountApi.register(name.trim(), email.trim(), password);
      } catch (cause) {
        // The server's answer is authoritative: adapt the form to it.
        if (mode === 'register' && cause instanceof AccountApiError && mounted.current) {
          if (cause.code === 'registration_closed') {
            setRegistration('closed');
            return;
          }
          if (cause.code === 'invite_required') setRegistration('invite');
        }
        throw cause;
      }
      if (!mounted.current) return;
      updateUser(session.user);
      setPassword('');
      setInviteCode('');
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

  const confirmDeleteBackup = (backup: BackupMetadata) => {
    const accountId = user?.id;
    const confirmedAccountRevision = accountRevision.current;
    Alert.alert(
      'Delete account backup?',
      `Delete the backup from ${new Date(backup.createdAt).toLocaleString()} from your account? This cannot be undone. Characters and settings on this device stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          if (!accountId || currentUser.current?.id !== accountId
            || accountRevision.current !== confirmedAccountRevision) return;
          void runAction('deleteBackup', async revision => {
            setDeletingBackupId(backup.id);
            try {
              await accountApi.deleteBackup(backup.id, accountId);
            } catch (cause) {
              // Already deleted, for example on another device: drop it from the list.
              if (!(cause instanceof AccountApiError && cause.status === 404)) throw cause;
            } finally {
              if (mounted.current) setDeletingBackupId(null);
            }
            if (!mounted.current || revision !== sessionRevision.current || currentUser.current?.id !== accountId) return;
            setBackups(previous => previous.filter(item => item.id !== backup.id));
            setNotice('Backup deleted from your account.');
          });
        } },
      ],
    );
  };

  const toggleSecurityForm = (form: SecurityForm) => {
    const next = securityForm === form ? null : form;
    clearSecurityForm();
    setSecurityForm(next);
    setError(null);
  };

  const submitPasswordChange = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const accountId = currentUser.current?.id;
    if (!accountId || checking || action.current !== null) return;
    if (!currentPassword || !newPassword) {
      setError('Enter your current password and a new password.');
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError('Choose a new password between 12 and 128 characters.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a new password that differs from your current one.');
      return;
    }
    void runAction('changePassword', async revision => {
      const session = await accountApi.changePassword(currentPassword, newPassword, accountId);
      if (!mounted.current || revision !== sessionRevision.current) return;
      updateUser(session.user);
      clearSecurityForm();
      setNotice('Password changed. Every other device was signed out; this one stays signed in.');
    });
  };

  const confirmLogoutEverywhere = () => {
    const accountId = currentUser.current?.id;
    const confirmedAccountRevision = accountRevision.current;
    if (!accountId) return;
    Alert.alert(
      'Sign out everywhere?',
      'This signs your account out on every device and browser, including this one. Characters and settings stay on each device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out everywhere', style: 'destructive', onPress: () => {
          if (currentUser.current?.id !== accountId || accountRevision.current !== confirmedAccountRevision) return;
          void runAction('logoutEverywhere', async () => {
            await accountApi.logoutEverywhere(accountId);
            if (!mounted.current) return;
            updateUser(null);
            setPassword('');
            setNotice('Signed out on every device. Your characters and settings remain on this device.');
          });
        } },
      ],
    );
  };

  const submitDeleteAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const account = currentUser.current;
    if (!account || checking || action.current !== null) return;
    if (!deletePassword) {
      setError('Enter your password to delete your account.');
      return;
    }
    const confirmedPassword = deletePassword;
    const confirmedAccountRevision = accountRevision.current;
    Alert.alert(
      'Delete your account permanently?',
      `This deletes ${account.email} and every backup saved to it from the server. It cannot be undone. Characters and settings on this device stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => {
          if (currentUser.current?.id !== account.id || accountRevision.current !== confirmedAccountRevision) return;
          void runAction('deleteAccount', async () => {
            await accountApi.deleteAccount(confirmedPassword, account.id);
            if (!mounted.current) return;
            updateUser(null);
            setPassword('');
            setNotice('Account deleted, along with its backups on the server. Your characters and settings remain on this device.');
          });
        } },
      ],
    );
  };

  const disabled = checking || busy !== null;
  const registrationClosed = mode === 'register' && registration === 'closed';
  const askInvite = mode === 'register' && (registration === 'invite' || registration === 'unknown');

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
                    {backups.map(backup => {
                      const savedAt = new Date(backup.createdAt).toLocaleString();
                      return (
                        <li key={backup.id}>
                          <div>
                            <time dateTime={backup.createdAt}>{savedAt}</time>
                            <span className="account-copy">{(backup.bytes / 1024).toFixed(1)} KiB</span>
                          </div>
                          <div className="account-actions">
                            <Button variant="ghost" disabled={disabled} onPress={() => confirmRestore(backup)}
                              ariaLabel={`Restore backup from ${savedAt}`}>
                              {busy === 'restore' ? 'Restoring…' : 'Restore'}
                            </Button>
                            <Button variant="ghost" disabled={disabled} onPress={() => confirmDeleteBackup(backup)}
                              ariaLabel={`Delete backup from ${savedAt}`}>
                              {deletingBackupId === backup.id ? 'Deleting…' : 'Delete'}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>}
              <div className="account-security">
                <div>
                  <h3>Account security</h3>
                  <p className="account-copy">
                    Change your password, sign out other devices, or delete this account and its backups.
                    Characters and settings on this device are never removed.
                  </p>
                </div>
                <div className="account-actions">
                  <button type="button" className={`btn-reset gc-btn gc-btn--${securityForm === 'password' ? 'brass' : 'ghost'}`}
                    aria-expanded={securityForm === 'password'} aria-controls="account-password-form"
                    disabled={disabled} onClick={() => toggleSecurityForm('password')}>
                    <span className="gc-btn-text">Change password</span>
                  </button>
                  <Button variant="ghost" disabled={disabled} onPress={confirmLogoutEverywhere}>
                    {busy === 'logoutEverywhere' ? 'Signing out everywhere…' : 'Sign out everywhere'}
                  </Button>
                  <button type="button" className={`btn-reset gc-btn gc-btn--${securityForm === 'delete' ? 'brass' : 'ghost'}`}
                    aria-expanded={securityForm === 'delete'} aria-controls="account-delete-form"
                    disabled={disabled} onClick={() => toggleSecurityForm('delete')}>
                    <span className="gc-btn-text">Delete account</span>
                  </button>
                </div>
                {securityForm === 'password' && (
                  <form id="account-password-form" className="account-form" aria-label="Change password" onSubmit={submitPasswordChange}>
                    <label>
                      Current password
                      <input type="password" name="current-password" autoComplete="current-password" required maxLength={128}
                        autoFocus value={currentPassword} disabled={disabled}
                        onChange={event => setCurrentPassword(event.target.value)} />
                    </label>
                    <label>
                      New password
                      <input type="password" name="new-password" autoComplete="new-password" required minLength={12} maxLength={128}
                        value={newPassword} aria-describedby="account-new-password-help" disabled={disabled}
                        onChange={event => setNewPassword(event.target.value)} />
                    </label>
                    <p className="account-copy" id="account-new-password-help">
                      Use 12–128 characters. Every other device is signed out; this one stays signed in.
                    </p>
                    <div className="account-actions">
                      <button type="submit" className="btn-reset gc-btn gc-btn--primary" disabled={disabled}>
                        <span className="gc-btn-text">{busy === 'changePassword' ? 'Updating password…' : 'Update password'}</span>
                      </button>
                      <Button variant="ghost" disabled={disabled} onPress={clearSecurityForm}>Cancel</Button>
                    </div>
                  </form>
                )}
                {securityForm === 'delete' && (
                  <form id="account-delete-form" className="account-form" aria-label="Delete account" onSubmit={submitDeleteAccount}>
                    <p className="account-copy" id="account-delete-help">
                      This permanently deletes your account and every backup saved to it from the server.
                      Characters and settings on this device stay.
                    </p>
                    <label>
                      Your password
                      <input type="password" name="delete-password" autoComplete="current-password" required maxLength={128}
                        autoFocus value={deletePassword} aria-describedby="account-delete-help" disabled={disabled}
                        onChange={event => setDeletePassword(event.target.value)} />
                    </label>
                    <div className="account-actions">
                      <button type="submit" className="btn-reset gc-btn gc-btn--primary" disabled={disabled}>
                        <span className="gc-btn-text">{busy === 'deleteAccount' ? 'Deleting account…' : 'Delete account permanently…'}</span>
                      </button>
                      <Button variant="ghost" disabled={disabled} onPress={clearSecurityForm}>Cancel</Button>
                    </div>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="account-modes" role="group" aria-label="Account access">
                <Button variant={mode === 'login' ? 'brass' : 'ghost'} disabled={disabled}
                  onPress={() => { setMode('login'); setPassword(''); setError(null); }}>Log in</Button>
                <Button variant={mode === 'register' ? 'brass' : 'ghost'} disabled={disabled}
                  onPress={() => { setMode('register'); setPassword(''); setError(null); }}>Create account</Button>
              </div>
              {registrationClosed ? (
                <p className="account-notice" role="status">
                  This server is not accepting new accounts. You can still log in to an existing account.
                </p>
              ) : (
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
                  {askInvite && <label>
                    {registration === 'invite' ? 'Invite code' : 'Invite code (if you have one)'}
                    <input name="invite-code" autoComplete="off" spellCheck={false} maxLength={256}
                      required={registration === 'invite'} value={inviteCode}
                      aria-describedby={registration === 'invite' ? 'account-invite-help' : undefined}
                      disabled={disabled} onChange={event => setInviteCode(event.target.value)} />
                  </label>}
                  {mode === 'register' && registration === 'invite' && (
                    <p className="account-copy" id="account-invite-help">
                      This server only accepts new accounts with an invite code from its owner.
                    </p>
                  )}
                  <button type="submit" className="btn-reset gc-btn gc-btn--primary" disabled={disabled}>
                    <span className="gc-btn-text">{busy === 'register' ? 'Creating account…' : busy === 'login' ? 'Logging in…' : mode === 'register' ? 'Register' : 'Sign in'}</span>
                  </button>
                </form>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
