import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';

type FinishAction = 'skip' | 'done';

type OnboardingModalProps = {
  visible: boolean;
  onFinish: (payload: { action: FinishAction }) => void | Promise<void>;
  submitting?: boolean;
};

const ONBOARDING_STEPS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; text: string }> = [
  {
    icon: 'people-outline',
    title: 'Build your squad',
    text: 'Build your squad within 90 credits. Roster: 4A / 2D / 1G / 1 FLEX. Captain gives 2× points.',
  },
  {
    icon: 'swap-horizontal-outline',
    title: 'Transfers',
    text: 'Transfers: 3 to start, +1/month (max 5).',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Locks',
    text: 'Players lock on days they have a match.',
  },
  {
    icon: 'calendar-outline',
    title: 'Matchweeks',
    text: 'Server-defined matchweeks, with matches grouped by dates.',
  },
];

export function OnboardingModal({ visible, onFinish, submitting = false }: OnboardingModalProps) {
  const { width } = useWindowDimensions();
  const slideWidth = Math.max(width - 32, 280);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const isLastStep = step === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    });
  }, [visible]);

  const stepTitle = useMemo(() => `Step ${step + 1} of ${ONBOARDING_STEPS.length}`, [step]);

  const handleSkip = () => {
    void onFinish({ action: 'skip' });
  };

  const handleNextOrDone = () => {
    if (!isLastStep) {
      const next = Math.min(step + 1, ONBOARDING_STEPS.length - 1);
      setStep(next);
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated: true });
      return;
    }
    void onFinish({ action: 'done' });
  };

  const handleBack = () => {
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    scrollRef.current?.scrollTo({ x: prev * slideWidth, animated: true });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.sheet}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>How it works</Text>
              <Pressable style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]} onPress={handleSkip}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>

            <Text style={styles.stepCounter}>{stepTitle}</Text>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={event => {
                const idx = Math.round(event.nativeEvent.contentOffset.x / slideWidth);
                setStep(Math.max(0, Math.min(idx, ONBOARDING_STEPS.length - 1)));
              }}
            >
              {ONBOARDING_STEPS.map((item, index) => (
                <View key={`slide-${index}`} style={[styles.slide, { width: slideWidth }]}>
                  <View style={styles.iconBubble}>
                    <Ionicons name={item.icon} size={20} color={COLORS.accent2} />
                  </View>
                  <Text style={styles.slideTitle}>{item.title}</Text>
                  <Text style={styles.copy}>{item.text}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.dotsRow}>
              {ONBOARDING_STEPS.map((_, index) => (
                <View key={`dot-${index}`} style={[styles.dot, index === step && styles.dotActive]} />
              ))}
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleBack}
                disabled={submitting || step === 0}
              >
                <Text style={[styles.secondaryBtnText, step === 0 && styles.secondaryBtnTextDisabled]}>Back</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleSkip}
                disabled={submitting}
              >
                <Text style={styles.secondaryBtnText}>Skip</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleNextOrDone}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>{isLastStep ? 'Done' : 'Next'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  safeArea: {
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: 'rgba(9, 18, 40, 0.98)',
    borderTopWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    maxHeight: 390,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '800',
  },
  skipBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  skipText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  stepCounter: {
    color: COLORS.muted2,
    fontSize: 12,
    fontWeight: '600',
  },
  slide: {
    minHeight: 154,
    paddingRight: 14,
    justifyContent: 'center',
    gap: 8,
  },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(93, 187, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  copy: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  dotActive: {
    width: 16,
    backgroundColor: COLORS.accent2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  secondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtnTextDisabled: {
    color: COLORS.muted2,
  },
  primaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
  },
});
