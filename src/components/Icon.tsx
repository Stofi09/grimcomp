import React from 'react';
import Svg, { Path, G, Rect, Circle, Line } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'shield' | 'grid' | 'scroll' | 'star' | 'crown' | 'book'
  | 'sword' | 'heart' | 'sparkle' | 'flame' | 'pack' | 'mask'
  | 'tome' | 'quill' | 'users' | 'gear' | 'plus' | 'search'
  | 'bell' | 'chev' | 'dice' | 'minus' | 'check' | 'info'
  | 'menu';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color = colors.ink2,
  strokeWidth = 1.6,
}) => {
  const stroke = color;
  const sw = strokeWidth;

  const inner = (() => {
    switch (name) {
      case 'shield':
        return <Path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'grid':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Rect x="4" y="4" width="7" height="7" />
            <Rect x="13" y="4" width="7" height="7" />
            <Rect x="4" y="13" width="7" height="7" />
            <Rect x="13" y="13" width="7" height="7" />
          </G>
        );
      case 'scroll':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 4h10a2 2 0 012 2v12a2 2 0 01-2 2H8a2 2 0 01-2-2V4z" />
            <Path d="M9 8h6M9 12h6M9 16h4" />
          </G>
        );
      case 'star':
        return <Path d="M12 3l2.6 5.4 5.9.8-4.3 4 1 5.8L12 16.3 6.8 19l1-5.8-4.3-4 5.9-.8L12 3z" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'crown':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M3 8l3 9h12l3-9-5 3-4-6-4 6-5-3z" />
            <Path d="M6 20h12" />
          </G>
        );
      case 'book':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 5a2 2 0 012-2h11v16H7a2 2 0 00-2 2V5z" />
            <Path d="M5 17a2 2 0 012-2h11" />
          </G>
        );
      case 'sword':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M14 3h7v7l-9 9-5-5 7-11z" />
            <Path d="M5 17l-2 4 4-2" />
          </G>
        );
      case 'heart':
        return <Path d="M12 20s-7-4.5-7-10a4 4 0 017-2.7A4 4 0 0119 10c0 5.5-7 10-7 10z" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'sparkle':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
          </G>
        );
      case 'flame':
        return <Path d="M12 3c1 3 4 4 4 8a4 4 0 01-8 0c0-2 1-3 2-4-1-2 0-3 2-4z" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'pack':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 8h12v12H6z" />
            <Path d="M9 8V5a3 3 0 016 0v3" />
            <Path d="M9 12h6" />
          </G>
        );
      case 'mask':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M4 7c0 7 3 12 8 12s8-5 8-12c-2 0-4 1-4 1s-2-1-4-1-2 1-4 1-4-1-4-1z" />
            <Circle cx="9" cy="11" r="0.8" fill={stroke} />
            <Circle cx="15" cy="11" r="0.8" fill={stroke} />
          </G>
        );
      case 'tome':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2V4z" />
            <Line x1="5" y1="4" x2="5" y2="18" />
            <Path d="M9 8h8" />
          </G>
        );
      case 'quill':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 4c-4 1-10 4-13 10l-2 6 6-2c6-3 9-9 10-13z" />
            <Path d="M10 14l-3 3" />
          </G>
        );
      case 'users':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="9" cy="8" r="3" />
            <Path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
            <Circle cx="17" cy="9" r="2.5" />
            <Path d="M15 15c3 0 6 2 6 5" />
          </G>
        );
      case 'gear':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="3" />
            <Path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
          </G>
        );
      case 'plus':
        return <Path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'search':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="11" cy="11" r="6" />
            <Path d="M20 20l-4-4" />
          </G>
        );
      case 'bell':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 16V11a6 6 0 0112 0v5l2 2H4z" />
            <Path d="M10 20a2 2 0 004 0" />
          </G>
        );
      case 'chev':
        return <Path d="M9 6l6 6-6 6" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'dice':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Rect x="4" y="4" width="16" height="16" rx="2" />
            <Circle cx="8.5" cy="8.5" r="1" fill={stroke} />
            <Circle cx="15.5" cy="8.5" r="1" fill={stroke} />
            <Circle cx="12" cy="12" r="1" fill={stroke} />
            <Circle cx="8.5" cy="15.5" r="1" fill={stroke} />
            <Circle cx="15.5" cy="15.5" r="1" fill={stroke} />
          </G>
        );
      case 'minus':
        return <Path d="M5 12h14" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'check':
        return <Path d="M5 12l4 4 10-10" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'info':
        return (
          <G stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="9" />
            <Path d="M12 8h.01M11 12h1v5h1" />
          </G>
        );
      case 'menu':
        return <Path d="M4 7h16M4 12h16M4 17h16" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      default:
        return null;
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {inner}
    </Svg>
  );
};
