import { useCallback } from 'react';
import { ContentProvider, useContentStatus } from '@/content/ContentProvider';
import { useContent } from '@/content/useContent';
import { useStoredScreen } from '@/hooks/useStoredScreen';
import { useActiveCharId } from '@/hooks/useCharacter';
import { Shell } from '@/components/Shell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AlertHost } from '@/ui/alert';

import { OverviewScreen } from '@/screens/OverviewScreen';
import { CharacteristicsScreen } from '@/screens/CharacteristicsScreen';
import { SkillsScreen } from '@/screens/SkillsScreen';
import { TalentsScreen } from '@/screens/TalentsScreen';
import { CareerScreen } from '@/screens/CareerScreen';
import { XpScreen } from '@/screens/XpScreen';
import { CombatScreen } from '@/screens/CombatScreen';
import { WoundsScreen } from '@/screens/WoundsScreen';
import { MagicScreen } from '@/screens/MagicScreen';
import { FaithScreen } from '@/screens/FaithScreen';
import { TrappingsScreen } from '@/screens/TrappingsScreen';
import { PsychologyScreen } from '@/screens/PsychologyScreen';
import { ReferenceScreen } from '@/screens/ReferenceScreen';
import { NotesScreen } from '@/screens/NotesScreen';
import { RosterScreen } from '@/screens/RosterScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { NewCharScreen } from '@/screens/NewCharScreen';

import './App.css';

// Inner app — lives under ContentProvider so it can read content load status
// and the registry. While packs are loading it shows the parchment splash;
// once loaded it renders the Shell + active screen.
function AppInner() {
  const [, screen, setScreen] = useStoredScreen('overview');
  const activeCharId = useActiveCharId();
  const status = useContentStatus();
  const registry = useContent();

  const renderScreen = useCallback(() => {
    switch (screen) {
      case 'overview': return <OverviewScreen />;
      case 'characteristics': return <CharacteristicsScreen />;
      case 'skills': return <SkillsScreen />;
      case 'talents': return <TalentsScreen />;
      case 'career': return <CareerScreen />;
      case 'xp': return <XpScreen />;
      case 'combat': return <CombatScreen />;
      case 'wounds': return <WoundsScreen />;
      case 'magic': return <MagicScreen />;
      case 'faith': return <FaithScreen />;
      case 'trappings': return <TrappingsScreen />;
      case 'psychology': return <PsychologyScreen />;
      case 'reference': return <ReferenceScreen />;
      case 'notes': return <NotesScreen />;
      case 'roster': return <RosterScreen onNav={setScreen} />;
      case 'settings': return <SettingsScreen />;
      case 'newchar': return <NewCharScreen onNav={setScreen} />;
      default: return <OverviewScreen />;
    }
  }, [screen, setScreen]);

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

  // The boundary wraps only the screen content — the rail / app-bar live in
  // Shell, outside `children`, so they stay interactive if a screen throws.
  // resetKey clears a caught error whenever the user navigates to another
  // screen or switches characters, so those paths recover without a reload.
  return (
    <Shell current={screen} onNav={setScreen}>
      <ErrorBoundary resetKey={`${screen}:${activeCharId}`}>
        {renderScreen()}
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
