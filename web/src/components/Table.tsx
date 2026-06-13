// Lightweight table primitives that match the styles.css `.tbl` patterns.
import React from 'react';
import './Table.css';

interface TableProps {
  children: React.ReactNode;
}

export const Table: React.FC<TableProps> = ({ children }) => (
  <div className="tbl">{children}</div>
);

interface TableRowProps {
  children: React.ReactNode;
  header?: boolean;
  style?: React.CSSProperties | null;
  last?: boolean;
  /** Optional press handler — renders the row as a button when provided. */
  onPress?: () => void;
}

export const TableRow: React.FC<TableRowProps> = ({ children, header, style, last, onPress }) => {
  const className = [
    'tbl-row',
    header ? 'tbl-row-header' : null,
    !last && !header ? 'tbl-row-divider' : null,
  ]
    .filter(Boolean)
    .join(' ');
  if (onPress) {
    return (
      <button
        type="button"
        className={`btn-reset ${className} tbl-row-press`}
        style={style ?? undefined}
        onClick={onPress}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={className} style={style ?? undefined}>
      {children}
    </div>
  );
};

interface CellProps {
  children: React.ReactNode;
  flex?: number;
  width?: number;
  num?: boolean;
  header?: boolean;
  style?: React.CSSProperties | null;
  textStyle?: React.CSSProperties | null;
  align?: 'left' | 'right' | 'center';
}

export const Cell: React.FC<CellProps> = ({ children, flex, width, num, header, style, textStyle, align }) => {
  const alignment: React.CSSProperties['alignItems'] =
    align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
  const className = [
    'tbl-cell',
    header ? 'tbl-cell-header' : null,
    num ? 'tbl-cell-num' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const inline: React.CSSProperties = {
    alignItems: num ? 'flex-end' : alignment,
    ...(flex != null ? { flex } : null),
    ...(width != null ? { width } : null),
    ...(style ?? null),
    ...(textStyle ?? null),
  };
  return (
    <div className={className} style={inline}>
      {children}
    </div>
  );
};
