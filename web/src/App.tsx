import { ContentProvider, useContentStatus } from '@/content/ContentProvider';
import { useContent, useNavModel } from '@/content/useContent';
import { useStoredScreen } from '@/hooks/useStoredScreen';
import { useActiveCharId } from '@/hooks/useCharacter';
import { Shell } from '@/components/Shell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AlertHost } from '@/ui/alert';
import { SCREEN_COMPONENTS } from '@/screens/ScreenRegistry';

import './App.css';

// Inner app — lives under ContentProvider so it can read content load status
// and the registry. While packs are loading it shows the parchment splash;
// once loaded it renders the Shell + active screen. Which screens exist, their
// order/labels/gating, and the landing screen all come from the resolved nav
// model (the built-in WFRP nav unless a pack ships a `screens` section).
function AppInner() {
  const navModel = useNavModel();
  const [, screen, setScreen] = useStoredScreen(navModel);
  const activeCharId = useActiveCharId();
  const status = useContentStatus();
  const registry = useContent();

  // Content failed to load AND nothing usable came through — surface the pack
  // errors on the splash so misconfigured packs are debuggable. A registry that
  // loaded *something* (despite stray errors) still renders the app normally.
  const registryEmpty = registry.allCharacterTemplates.length === 0;
  const hardFailure = !status.loading && status.errors.length > 0 && registryEmpty;

  if (status.loading || hardFailure) {
    return (
      <div className="app-splash">
        <div className="app-splash-spinner" aria-hidden="true" />
        <span className="app-splash-eyebrow">A grimdark companion</span>
        <h1 className="app-splash-title">Grim Companion</h1>
        {hardFailure ? (
          <div className="app-splash-errors">
            <p className="app-splash-errors-head">Content failed to load:</p>
            {status.errors.map((e, i) => (
              <p key={i} className="app-splash-error">{e}</p>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Look the active screen up by id (a screen gated out of the rail is still
  // routable — its component shows its own empty state). Fall back to the
  // landing screen, then Overview, so a stale/unknown id can never blank out.
  const item = navModel.itemsById[screen] ?? navModel.itemsById[navModel.defaultScreenId];
  const Screen = (item ? SCREEN_COMPONENTS[item.kind] : SCREEN_COMPONENTS.overview)
    ?? SCREEN_COMPONENTS.overview;

  // The boundary wraps only the screen content — the rail / app-bar live in
  // Shell, outside `children`, so they stay interactive if a screen throws.
  // resetKey clears a caught error whenever the user navigates to another
  // screen or switches characters, so those paths recover without a reload.
  return (
    <Shell current={screen} onNav={setScreen}>
      <ErrorBoundary resetKey={`${screen}:${activeCharId}`}>
        <Screen onNav={setScreen} />
      </ErrorBoundary>
    </Shell>
  );
}

export default function App() {
  return (
    <ContentProvider>
      <AppInner />
      <AlertHost />
    </ContentProvider>
  );
}
