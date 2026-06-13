// Master/detail shell. iPad ≥ RAIL_BREAKPOINT: rail inline. iPhone: slide-over.
import React, { useState, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, RAIL_BREAKPOINT, RAIL_WIDTH } from '@/theme';
import { Rail } from './Rail';
import { AppBar } from './AppBar';
import type { ScreenId } from '@/data/nav';
import { SCREEN_CRUMBS } from '@/data/nav';
import { useCharacter } from '@/hooks/useCharacter';

interface ShellProps {
  current: ScreenId;
  onNav: (id: ScreenId) => void;
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({ current, onNav, children }) => {
  const { width } = useWindowDimensions();
  const isWide = width >= RAIL_BREAKPOINT;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Character-scoped crumbs carry a placeholder name; swap in the active PC so
  // the trail reflects whoever is selected, not the sample character.
  const { template } = useCharacter();
  const crumbs = (SCREEN_CRUMBS[current] ?? ['Character']).map(c =>
    c === 'Sigmund Braun' ? template.name : c,
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.shell}>
        {isWide ? <Rail current={current} onNav={onNav} /> : null}
        <View style={styles.main}>
          <AppBar
            crumbs={crumbs}
            showMenu={!isWide}
            onMenuPress={() => setDrawerOpen(true)}
          />
          <View style={styles.content}>{children}</View>
        </View>
      </View>

      {!isWide ? (
        <Modal
          visible={drawerOpen}
          animationType="slide"
          transparent
          onRequestClose={closeDrawer}
        >
          <View style={styles.modalRoot}>
            <Rail
              current={current}
              onNav={onNav}
              onClose={closeDrawer}
              width={Math.min(RAIL_WIDTH + 20, Math.round(width * 0.85))}
            />
            <Pressable style={styles.scrim} onPress={closeDrawer} />
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  shell: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, flexDirection: 'column' },
  content: { flex: 1 },
  modalRoot: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
});
