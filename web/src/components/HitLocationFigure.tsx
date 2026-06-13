import React from 'react';
import { colors } from '@/theme';
import './HitLocationFigure.css';

const FONT_DISPLAY = "'IM Fell English', Georgia, serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

interface AP {
  head: number; arm_l: number; arm_r: number; body: number; leg_l: number; leg_r: number;
}

type LocationKey = 'head' | 'body' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';

const DEFAULT_LABELS: Record<LocationKey, string> = {
  head: 'FEJ',
  body: 'TEST',
  arm_l: 'B. KAR',
  arm_r: 'J. KAR',
  leg_l: 'B. LÁB',
  leg_r: 'J. LÁB',
};

interface Props {
  ap: AP;
  labels?: Record<LocationKey, string>;
}

const Dot: React.FC<{ label: string; val: number; x: number; y: number }> = ({ label, val, x, y }) => (
  <>
    <rect x={x - 16} y={y - 16} width={32} height={32} rx={3}
      fill={colors.ivory}
      stroke={val > 0 ? colors.brass : colors.borderSoft}
      strokeWidth={1.5}
    />
    <text
      x={x}
      y={y + 5}
      textAnchor="middle"
      fontFamily={FONT_DISPLAY}
      fontSize={18}
      fill={val > 0 ? colors.ink : colors.ink4}
    >
      {String(val)}
    </text>
    <text
      x={x}
      y={y + 30}
      textAnchor="middle"
      fontFamily={FONT_MONO}
      fontSize={8.5}
      fill={colors.ink3}
    >
      {label}
    </text>
  </>
);

export const HitLocationFigure: React.FC<Props> = ({ ap, labels = DEFAULT_LABELS }) => (
  <svg
    className="hlf-figure"
    viewBox="0 0 240 360"
    width={240}
    height={360}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx={120} cy={42} r={22} fill={colors.surface3} stroke={colors.borderStrong} strokeWidth={1.4} />
    <path
      d="M95 65 L70 78 L48 145 L62 156 L80 100 L80 185 L70 285 L88 288 L102 190 L120 190 L138 190 L152 288 L170 285 L160 185 L160 100 L178 156 L192 145 L170 78 L145 65 Z"
      fill={colors.surface3}
      stroke={colors.borderStrong}
      strokeWidth={1.4}
    />
    <line x1={120} y1={65} x2={120} y2={190} stroke={colors.borderSoft} strokeDasharray="2,3" />
    <Dot label={labels.head} val={ap.head} x={120} y={42} />
    <Dot label={labels.body} val={ap.body} x={120} y={140} />
    <Dot label={labels.arm_l} val={ap.arm_l} x={48} y={125} />
    <Dot label={labels.arm_r} val={ap.arm_r} x={192} y={125} />
    <Dot label={labels.leg_l} val={ap.leg_l} x={90} y={260} />
    <Dot label={labels.leg_r} val={ap.leg_r} x={150} y={260} />
  </svg>
);
