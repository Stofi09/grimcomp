// Centred modal sheet for add/edit forms. Used for weapons, armour,
// trappings, notes, etc. Slides up on iPhone, presents as a centred form
// sheet on iPad (RN's default modal presentation style on iOS).

import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontFamilies, radius, space } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';

interface EditSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Optional left-side action (e.g. "Delete"). */
  destructive?: { label: string; onPress: () => void };
  children: React.ReactNode;
}

export const EditSheet: React.FC<EditSheetProps> = ({
  visible,
  title,
  subtitle,
  onClose,
  onSave,
  saveLabel = 'Save',
  saveDisabled,
  destructive,
  children,
}) => (
  <Modal
    visible={visible}
    animationType="slide"
    transparent
    onRequestClose={onClose}
  >
    <KeyboardAvoidingView
      style={styles.backdrop}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.backdropTap} onPress={onClose} />

      <View style={styles.sheet}>
        <LinearGradient
          pointerEvents="none"
          colors={[colors.ivory, colors.bone]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: radius.lg }]}
        />

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Icon name="plus" size={18} color={colors.ink2} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>

        <View style={styles.footer}>
          {destructive ? (
            <Button
              variant="ghost"
              textStyle={{ color: colors.empire }}
              onPress={destructive.onPress}
            >
              {destructive.label}
            </Button>
          ) : (
            <View />
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button variant="ghost" onPress={onClose}>Cancel</Button>
            {onSave ? (
              <Button variant="primary" disabled={saveDisabled} onPress={onSave}>
                {saveLabel}
              </Button>
            ) : null}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 10, 5, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: colors.ivory,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#3c280f',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink3,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    transform: [{ rotate: '45deg' }], // turns the "plus" icon into an "x"
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: space.xxl,
    maxHeight: 480,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: 'transparent',
  },
});
