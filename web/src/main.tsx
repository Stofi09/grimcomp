import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/theme.css';
import './styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  initializeWebStorage,
  renderStorageBootFailure,
  resyncWebStorageBeforeRender,
} from './storage/storageBoot';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');

  // Recovery is a hard gate: no migration or hook may touch gameplay data
  // while an interrupted journal is unresolved.
  let storage: Awaited<ReturnType<typeof initializeWebStorage>>;
  try {
    storage = await initializeWebStorage();
  } catch (error) {
    renderStorageBootFailure(root, {
      title: 'Local data could not be opened safely',
      message: `Storage initialization stopped unexpectedly. ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  if (!storage.ok) {
    renderStorageBootFailure(root, storage);
    return;
  }

  // Import the React tree only after recovery, migration, listener installation,
  // and a final locked resync. No hook can hydrate from a half-applied journal
  // or from a schema that raced ahead during this dynamic import boundary.
  const { default: App } = await import('./App');
  const postImportResync = await resyncWebStorageBeforeRender();
  if (!postImportResync.ok) {
    renderStorageBootFailure(root, {
      stage: 'resync',
      title: 'Local data changed while the app loaded',
      message: `${postImportResync.message} Gameplay state was not rendered. Reload to retry synchronization.`,
    });
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
