import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts as useImFell,
  IMFellEnglish_400Regular,
  IMFellEnglish_400Regular_Italic,
} from '@expo-google-fonts/im-fell-english';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';

import { Shell } from '@/components/Shell';
import { ContentProvider } from '@/content/ContentProvider';
import { useStoredScreen } from '@/hooks/useStoredScreen';
import { useNativeStorageGate } from '@/storage/useNativeStorage';
import { colors } from '@/theme';

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

export default function App() {
  const [fontsLoaded] = useImFell({
    IMFellEnglish_400Regular,
    IMFellEnglish_400Italic: IMFellEnglish_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  const storage = useNativeStorageGate();

  if (storage.blocked) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>Storage recovery required</Text>
        <Text style={styles.errorText}>
          {storage.lastError?.message ?? 'Saved data could not be verified safely. Gameplay storage was not opened; restart after resolving the recovery issue.'}
        </Text>
      </View>
    );
  }

  if (!fontsLoaded || !storage.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brass} />
        <Text style={styles.loadingText}>
          {storage.phase === 'booting' ? 'Checking saved data…' : 'Grim Companion'}
        </Text>
      </View>
    );
  }

  return <ReadyApp />;
}

/** Mounted only after crash recovery and migrations have completed. */
const ReadyApp: React.FC = () => {

  const [screenReady, screen, setScreen] = useStoredScreen('overview');

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
  }, [screen]);

  if (!screenReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brass} />
        <Text style={styles.loadingText}>Grim Companion</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ContentProvider>
        <Shell current={screen} onNav={setScreen}>
          {renderScreen()}
        </Shell>
      </ContentProvider>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.ink2,
    letterSpacing: 1.2,
  },
  errorTitle: {
    color: colors.empire,
    fontSize: 20,
    fontWeight: '700',
  },
  errorText: {
    color: colors.ink2,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 520,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});
