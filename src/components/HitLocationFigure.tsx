import React from 'react';
import Svg, { Path, Circle, Rect, Text as SvgText, Line } from 'react-native-svg';

interface AP {
  head: number; arm_l: number; arm_r: number; body: number; leg_l: number; leg_r: number;
}

interface Props { ap: AP; }

const Dot: React.FC<{ label: string; val: number; x: number; y: number }> = ({ label, val, x, y }) => (
  <>
    <Rect x={x - 16} y={y - 16} width={32} height={32} rx={3}
      fill="#fbf3df"
      stroke={val > 0 ? '#8a6f1c' : '#cdbfa3'}
      strokeWidth={1.5}
    />
    <SvgText
      x={x}
      y={y + 5}
      textAnchor="middle"
      fontFamily="IMFellEnglish_400Regular"
      fontSize={18}
      fill={val > 0 ? '#1f1812' : '#a3927a'}
    >
      {String(val)}
    </SvgText>
    <SvgText
      x={x}
      y={y + 30}
      textAnchor="middle"
      fontFamily="JetBrainsMono_400Regular"
      fontSize={8.5}
      fill="#76654c"
    >
      {label}
    </SvgText>
  </>
);

export const HitLocationFigure: React.FC<Props> = ({ ap }) => (
  <Svg viewBox="0 0 240 360" width={240} height={360}>
    <Circle cx={120} cy={42} r={22} fill="#e2d4b6" stroke="#8d7a5b" strokeWidth={1.4} />
    <Path
      d="M95 65 L70 78 L48 145 L62 156 L80 100 L80 185 L70 285 L88 288 L102 190 L120 190 L138 190 L152 288 L170 285 L160 185 L160 100 L178 156 L192 145 L170 78 L145 65 Z"
      fill="#e2d4b6"
      stroke="#8d7a5b"
      strokeWidth={1.4}
    />
    <Line x1={120} y1={65} x2={120} y2={190} stroke="#cdbfa3" strokeDasharray="2,3" />
    <Dot label="FEJ" val={ap.head} x={120} y={42} />
    <Dot label="TEST" val={ap.body} x={120} y={140} />
    <Dot label="B. KAR" val={ap.arm_l} x={48} y={125} />
    <Dot label="J. KAR" val={ap.arm_r} x={192} y={125} />
    <Dot label="B. LÁB" val={ap.leg_l} x={90} y={260} />
    <Dot label="J. LÁB" val={ap.leg_r} x={150} y={260} />
  </Svg>
);
