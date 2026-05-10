// Lightweight table primitives that match the styles.css `.tbl` patterns.
import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { colors, fontFamilies } from '@/theme';
import { tabular } from './primitives';

interface TableProps {
  children: React.ReactNode;
}

export const Table: React.FC<TableProps> = ({ children }) => (
  <View>{children}</View>
);

interface TableRowProps {
  children: React.ReactNode;
  header?: boolean;
  style?: StyleProp<ViewStyle>;
  last?: boolean;
  /** Optional press handler — wraps the row in Pressable when provided. */
  onPress?: () => void;
}

export const TableRow: React.FC<TableRowProps> = ({ children, header, style, last, onPress }) => {
  const rowStyle: StyleProp<ViewStyle> = [
    styles.row,
    header ? styles.header : null,
    !last && !header ? styles.divider : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={2}
        style={({ pressed }) => [rowStyle, pressed && styles.rowPressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{children}</View>;
};

interface CellProps {
  children: React.ReactNode;
  flex?: number;
  width?: number;
  num?: boolean;
  header?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  align?: 'left' | 'right' | 'center';
}

// True for `'foo'`, `42`, or arrays composed entirely of those + null/undefined/booleans.
// Catches the JSX `+{n}` case (children = ['+', n]) which otherwise renders as a bare
// string inside a View and triggers the "Text strings must be rendered within a Text component" error.
const isTextLike = (children: React.ReactNode): boolean => {
  if (children == null || typeof children === 'boolean') return true;
  if (typeof children === 'string' || typeof children === 'number') return true;
  if (Array.isArray(children)) return children.every(isTextLike);
  return false;
};

export const Cell: React.FC<CellProps> = ({ children, flex, width, num, header, style, textStyle, align }) => {
  const alignment: ViewStyle['alignItems'] = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
  return (
    <View
      style={[
        styles.cell,
        header ? styles.cellHeader : null,
        flex != null ? { flex } : null,
        width != null ? { width } : null,
        { alignItems: num ? 'flex-end' : alignment },
        style,
      ]}
    >
      {isTextLike(children) ? (
        <Text
          style={[
            header ? styles.headerText : styles.cellText,
            num ? [styles.num, tabular] : null,
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : children}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  header: {
    backgroundColor: colors.surface3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowPressed: {
    backgroundColor: colors.brassHighlight,
  },
  cell: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    flex: 1,
    justifyContent: 'center',
  },
  cellHeader: { paddingVertical: 8 },
  cellText: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    color: colors.ink,
  },
  headerText: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  num: { fontFamily: fontFamilies.monoMedium },
});
