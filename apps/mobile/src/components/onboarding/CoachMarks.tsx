import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../theme/colors';

export type CoachMarkRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CoachMarkStep = {
  key: string;
  title: string;
  body: string;
  measureTarget: () => Promise<CoachMarkRect | null>;
};

type Props = {
  visible: boolean;
  steps: CoachMarkStep[];
  onDone: () => void;
  onSkip: () => void;
};

const OVERLAY_PAD = 10;
const CARD_WIDTH_MAX = 312;
const TOOLTIP_GAP = 14;
const TOOLTIP_HEIGHT_ESTIMATE = 184;

export function CoachMarks({ visible, steps, onDone, onSkip }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<CoachMarkRect | null>(null);
  const transition = useRef(new Animated.Value(0)).current;
  const resolveIdRef = useRef(0);

  const animateIn = useCallback(() => {
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [transition]);

  const resolveStep = useCallback(
    async (startIndex: number, direction: 1 | -1) => {
      if (!steps.length) {
        onSkip();
        return;
      }
      const resolveId = ++resolveIdRef.current;
      let cursor = startIndex;

      while (cursor >= 0 && cursor < steps.length) {
        const rect = await steps[cursor].measureTarget();
        if (resolveId !== resolveIdRef.current) return;
        if (rect && rect.width > 0 && rect.height > 0) {
          setActiveIndex(cursor);
          setTargetRect(rect);
          animateIn();
          return;
        }
        cursor += direction;
      }

      if (direction === 1) {
        onDone();
      } else {
        onSkip();
      }
    },
    [animateIn, onDone, onSkip, steps],
  );

  useEffect(() => {
    if (!visible) return;
    void resolveStep(0, 1);
  }, [resolveStep, visible]);

  useEffect(() => {
    if (!visible || !steps[activeIndex]) return;
    const timer = setTimeout(() => {
      void resolveStep(activeIndex, 1);
    }, 20);
    return () => clearTimeout(timer);
  }, [activeIndex, height, resolveStep, steps, visible, width]);

  const overlayRect = useMemo(() => {
    if (!targetRect) return null;
    const left = Math.max(8, targetRect.x - OVERLAY_PAD);
    const top = Math.max(insets.top + 4, targetRect.y - OVERLAY_PAD);
    const maxWidth = width - left - 8;
    const maxHeight = height - top - insets.bottom - 8;
    return {
      left,
      top,
      width: Math.max(28, Math.min(maxWidth, targetRect.width + OVERLAY_PAD * 2)),
      height: Math.max(28, Math.min(maxHeight, targetRect.height + OVERLAY_PAD * 2)),
    };
  }, [height, insets.bottom, insets.top, targetRect, width]);

  const tooltipStyle = useMemo(() => {
    if (!overlayRect) return null;
    const cardWidth = Math.min(CARD_WIDTH_MAX, width - 24);
    const centerX = overlayRect.left + overlayRect.width / 2;
    const left = Math.max(12, Math.min(width - cardWidth - 12, centerX - cardWidth / 2));
    const belowTop = overlayRect.top + overlayRect.height + TOOLTIP_GAP;
    const aboveTop = overlayRect.top - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_GAP;
    const placeBelow = belowTop + TOOLTIP_HEIGHT_ESTIMATE < height - insets.bottom - 6;
    const top = placeBelow ? belowTop : Math.max(insets.top + 6, aboveTop);
    return { width: cardWidth, left, top };
  }, [height, insets.bottom, insets.top, overlayRect, width]);

  const current = steps[activeIndex];
  const canGoBack = activeIndex > 0;

  const handleBack = () => {
    if (!canGoBack) return;
    void resolveStep(activeIndex - 1, -1);
  };

  const handleNext = () => {
    if (activeIndex >= steps.length - 1) {
      onDone();
      return;
    }
    void resolveStep(activeIndex + 1, 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.overlay}>
        <BlurView tint="dark" intensity={20} style={StyleSheet.absoluteFillObject} />
        <View style={styles.dimLayer} />

        {overlayRect ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.spotlight,
              {
                left: overlayRect.left,
                top: overlayRect.top,
                width: overlayRect.width,
                height: overlayRect.height,
                opacity: transition,
              },
            ]}
          />
        ) : null}

        {current && tooltipStyle ? (
          <Animated.View
            style={[
              styles.tipCard,
              tooltipStyle,
              {
                opacity: transition,
                transform: [
                  {
                    translateY: transition.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.stepText}>{t('common.tipOf', { current: activeIndex + 1, total: steps.length })}</Text>
            <Text style={styles.tipTitle}>{current.title}</Text>
            <Text style={styles.tipBody}>{current.body}</Text>

            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, (pressed || !canGoBack) && styles.pressed]}
                disabled={!canGoBack}
                onPress={handleBack}
              >
                <Text style={[styles.secondaryText, !canGoBack && styles.secondaryTextDisabled]}>{t('common.back')}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]} onPress={onSkip}>
                <Text style={styles.secondaryText}>{t('common.skip')}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={handleNext}>
                <Text style={styles.primaryText}>{activeIndex >= steps.length - 1 ? t('common.done') : t('common.next')}</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.closeBtn}
              onPress={onSkip}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={18} color={COLORS.muted} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  dimLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 8, 22, 0.56)',
  },
  spotlight: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(165, 210, 255, 0.78)',
    backgroundColor: 'rgba(124, 178, 244, 0.08)',
    shadowColor: 'rgba(143, 180, 255, 1)',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  tipCard: {
    position: 'absolute',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(8, 18, 39, 0.97)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 0,
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    zIndex: 20,
    elevation: 20,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: COLORS.muted2,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  tipTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    marginRight: 34,
  },
  tipBody: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginTop: 10,
    marginBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryTextDisabled: {
    color: COLORS.muted2,
  },
  primaryBtn: {
    flex: 1.15,
    height: 42,
    borderRadius: 11,
    backgroundColor: COLORS.latvianMaroon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
  },
});
