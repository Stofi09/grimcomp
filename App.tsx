import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert, Share } from 'react-native';
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
import { useNativeStorageGate, useRetryNativeStorage } from '@/storage/useNativeStorage';
import {
  buildNativeRecoveryDiagnosticExport,
  resetNativeStorageForRecovery,
} from '@/storage/settingsData';
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
  const retryStorage = useRetryNativeStorage();
  const [recoveryAction, setRecoveryAction] = useState<'retry' | 'export' | 'reset' | null>(null);

  const retryRecovery = async () => {
    if (recoveryAction) return;
    setRecoveryAction('retry');
    try {
      const result = await retryStorage();
      if (result.blocked) {
        Alert.alert('Recovery still blocked', result.lastError?.message ?? 'Saved data is still unavailable.');
      }
    } finally {
      setRecoveryAction(null);
    }
  };

  const exportRecoveryDiagnostic = async () => {
    if (recoveryAction) return;
    setRecoveryAction('export');
    try {
      const json = await buildNativeRecoveryDiagnosticExport();
      await Share.share({
        title: 'Grim Companion storage diagnostic',
        message: json,
      });
    } catch (error) {
      Alert.alert('Diagnostic export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRecoveryAction(null);
    }
  };

  const confirmRecoveryReset = () => {
    if (recoveryAction) return;
    Alert.alert(
      'Reset blocked local data?',
      'This installs a durable confirmation witness and restartable reset marker, then permanently removes all Grim Companion data—including an unrecoverable journal—and installs this build\'s storage schema marker. Export a diagnostic first if you may need the raw values.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setRecoveryAction('reset');
            try {
              const result = await resetNativeStorageForRecovery();
              if (!result.ok) {
                Alert.alert(
                  'Reset incomplete',
                  `${result.error.message}\n\nSome data may already be removed. If confirmation markers remain, the reset will resume on restart.`,
                );
              }
            } catch (error) {
              Alert.alert(
                'Reset incomplete',
                `${error instanceof Error ? error.message : String(error)}\n\nSome data may already be removed; restart to resume any confirmed reset.`,
              );
            } finally {
              setRecoveryAction(null);
            }
          },
        },
      ],
    );
  };

  if (storage.blocked) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>Storage recovery required</Text>
        <Text style={styles.errorText}>
          {storage.lastError?.message ?? 'Saved data could not be verified safely. Gameplay storage was not opened; restart after resolving the recovery issue.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={recoveryAction !== null}
          onPress={() => { void retryRecovery(); }}
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
        >
          <Text style={styles.retryButtonText}>{recoveryAction === 'retry' ? 'Retrying…' : 'Retry recovery'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={recoveryAction !== null}
          onPress={() => { void exportRecoveryDiagnostic(); }}
          style={({ pressed }) => [styles.recoverySecondaryButton, pressed && styles.retryButtonPressed]}
        >
          <Text style={styles.recoverySecondaryText}>{recoveryAction === 'export' ? 'Preparing…' : 'Export raw diagnostic'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={recoveryAction !== null}
          onPress={confirmRecoveryReset}
          style={({ pressed }) => [styles.recoveryResetButton, pressed && styles.retryButtonPressed]}
        >
          <Text style={styles.recoveryResetText}>{recoveryAction === 'reset' ? 'Resetting…' : 'Reset local data'}</Text>
        </Pressable>
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
  retryButton: {
    marginTop: 4,
    borderRadius: 6,
    backgroundColor: colors.empire,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryButtonPressed: {
    opacity: 0.75,
  },
  retryButtonText: {
    color: colors.ivory,
    fontSize: 14,
    fontWeight: '700',
  },
  recoverySecondaryButton: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.ink3,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  recoverySecondaryText: {
    color: colors.ink2,
    fontSize: 14,
    fontWeight: '600',
  },
  recoveryResetButton: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.empire,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  recoveryResetText: {
    color: colors.empire,
    fontSize: 14,
    fontWeight: '700',
  },
});
