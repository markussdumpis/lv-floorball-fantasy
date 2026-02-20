import React from 'react';
import { View, Text, StyleSheet, Pressable, GestureResponderEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../theme/colors';

type Props = {
  size: number;
  name: string;
  team: string;
  position: string;
  price: string;
  isCaptain?: boolean;
  isLocked?: boolean;
  isEmpty?: boolean;
  onPress: (e: GestureResponderEvent) => void;
};

const getLastNameFromDbName = (fullName: string): string => {
  try {
    const trimmed = (fullName || '').trim();
    if (!trimmed) return fullName;
    const withoutNumber = trimmed.replace(/\s+#\d+\s*$/i, '').trim();
    const parts = withoutNumber.split(/\s+/).filter(Boolean);
    if (!parts.length) return fullName;
    return parts[parts.length - 1];
  } catch {
    return fullName;
  }
};

export function SquadShirtSlot({
  size,
  name,
  team,
  position,
  price,
  isCaptain = false,
  isLocked = false,
  isEmpty = false,
  onPress,
}: Props) {
  const displayName = getLastNameFromDbName(name);
  const circleSize = size;
  const radius = circleSize / 2;
  const gradient = isEmpty
    ? (['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.05)'] as const)
    : (['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.02)'] as const);
  const borderColor = 'rgba(255,255,255,0.08)';
  const emptyOpacity = isEmpty ? 0.75 : 1;

  return (
    <View style={[styles.container, { width: circleSize }]}>
      <Pressable
        style={({ pressed }) => [
          styles.circlePress,
          !isCaptain && styles.nonCaptainGlass,
          {
            width: circleSize,
            height: circleSize,
            borderRadius: radius,
            borderColor,
            borderWidth: 1,
            backgroundColor: undefined,
            opacity: (pressed ? 0.88 : 0.84) * emptyOpacity,
            transform: pressed ? [{ translateY: 1 }] : [],
          },
        ]}
        onPress={onPress}
        android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: true }}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
        />
        {isCaptain ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: radius,
                borderWidth: 3,
                borderColor: '#B91C1C',
                opacity: 0.65,
              },
            ]}
          />
        ) : null}
        {!isCaptain ? (
          <LinearGradient
            colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0)'] as const}
            start={{ x: 0.5, y: 0.15 }}
            end={{ x: 0.5, y: 1 }}
            style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
            pointerEvents="none"
          />
        ) : null}
        {isEmpty ? (
          <View style={styles.plusWrap} pointerEvents="none">
            <Text style={styles.plus}>+</Text>
          </View>
        ) : (
          <View style={[styles.textBlock, { maxWidth: circleSize * 0.92, paddingHorizontal: 8 }]}>
            <Text
              style={[
                styles.name,
                isEmpty && styles.emptyText,
              ]}
              numberOfLines={1}
              ellipsizeMode="clip"
              adjustsFontSizeToFit={false}
            >
              {displayName}
            </Text>
            <Text
              style={[styles.team, isEmpty && styles.emptySub]}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit={false}
            >
              {team}
            </Text>
            <Text
              style={[styles.price, isEmpty && styles.emptySub]}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit={false}
            >
              <Text style={styles.priceNumber}>{price.replace(/k$/i, '')}</Text>
              <Text style={styles.priceSuffix}>K</Text>
            </Text>
          </View>
        )}
        {isCaptain ? (
          <View style={styles.captainBadgeHalf}>
            <Text style={styles.captainBadgeText}>C</Text>
          </View>
        ) : null}
        {isLocked ? (
          <View style={styles.lockBadgeWrap} pointerEvents="none">
            <View style={styles.lockBadge}>
              <Text style={styles.lockBadgeText} numberOfLines={1} allowFontScaling={false}>
                Locked
              </Text>
            </View>
          </View>
        ) : null}
      </Pressable>
      <Text style={styles.position} allowFontScaling={false}>
        {position}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  circlePress: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  nonCaptainGlass: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  captainGlow: {
    shadowColor: '#FF4D4F',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  plusWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 30,
    fontWeight: '700',
    textShadowColor: 'rgba(255,255,255,0.12)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  textBlock: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  name: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
    lineHeight: 19,
    textAlign: 'center',
    includeFontPadding: false,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  team: {
    color: 'rgba(167,195,255,0.9)',
    fontWeight: '700',
    fontSize: 11.2,
    lineHeight: 13,
    textAlign: 'center',
    includeFontPadding: false,
  },
  price: {
    color: '#8AB4FF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
  priceNumber: {
    color: '#8AB4FF',
    fontSize: 11,
    fontWeight: '700',
  },
  priceSuffix: {
    color: '#8AB4FF',
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.7,
    marginLeft: 1,
  },
  captainBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FF4D4F',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 20,
  },
  captainBadgeHalf: {
    position: 'absolute',
    top: -8,
    left: '50%',
    marginLeft: -12,
    width: 24,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 25,
    overflow: 'visible',
  },
  captainBadgeText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  lockBadgeWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  lockBadge: {
    minWidth: 92,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: 'rgba(139,18,32,0.9)',
    borderWidth: 1,
    borderColor: COLORS.latvianMaroonMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  lockBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  position: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.35,
    textAlign: 'center',
  },
  captainHalo: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(180,28,43,0.85)',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.82)',
  },
  emptySub: {
    color: 'rgba(255,255,255,0.45)',
  },
});
