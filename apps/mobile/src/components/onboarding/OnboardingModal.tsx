import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../theme/colors';

type FinishAction = 'skip' | 'done';

type OnboardingModalProps = {
  visible: boolean;
  onFinish: (payload: { action: FinishAction }) => void | Promise<void>;
  submitting?: boolean;
};

type OnboardingStep = {
  icon?: keyof typeof Ionicons.glyphMap | null;
  title: string;
  kicker?: string;
  text?: string;
  bullets?: string[];
};

export function OnboardingModal({ visible, onFinish, submitting = false }: OnboardingModalProps) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const cardWidth = Math.min(420, Math.floor(width * 0.9));
  const bodyWidth = Math.max(250, cardWidth - 32);
  const cardMaxHeight = Math.floor(height * 0.74);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const ONBOARDING_STEPS: OnboardingStep[] = useMemo(
    () => [
      {
        icon: 'sparkles-outline',
        title: t('onboarding.main.step1.title'),
        bullets: [
          t('onboarding.main.step1.bullet1'),
          t('onboarding.main.step1.bullet2'),
          t('onboarding.main.step1.bullet3'),
        ],
      },
      {
        icon: null,
        title: t('onboarding.main.step2.title'),
        kicker: t('onboarding.main.step2.kicker'),
        text: t('onboarding.main.step2.text'),
      },
      {
        icon: null,
        title: t('onboarding.main.step3.title'),
        bullets: [t('onboarding.main.step3.bullet1'), t('onboarding.main.step3.bullet2')],
      },
      {
        icon: null,
        title: t('onboarding.main.step4.title'),
        text: t('onboarding.main.step4.text'),
      },
    ],
    [t],
  );
  const isFirstStep = step === 0;
  const isLastStep = step === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    });
  }, [visible]);

  const stepTitle = useMemo(
    () => t('common.stepOf', { current: step + 1, total: ONBOARDING_STEPS.length }),
    [ONBOARDING_STEPS.length, step, t],
  );

  const handleSkip = () => {
    if (submitting) return;
    void onFinish({ action: 'skip' });
  };

  const handleNextOrDone = () => {
    if (!isLastStep) {
      const next = Math.min(step + 1, ONBOARDING_STEPS.length - 1);
      setStep(next);
      scrollRef.current?.scrollTo({ x: next * bodyWidth, animated: true });
      return;
    }
    void onFinish({ action: 'done' });
  };

  const handleBack = () => {
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    scrollRef.current?.scrollTo({ x: prev * bodyWidth, animated: true });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <BlurView tint="dark" intensity={16} style={StyleSheet.absoluteFillObject} />
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.card, { width: cardWidth, maxHeight: cardMaxHeight }]}>
            <View style={styles.headerRow}>
              {!isFirstStep ? <Text style={styles.title}>{t('onboarding.main.howItWorks')}</Text> : <View />}
              <Pressable
                style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
                onPress={handleSkip}
                disabled={submitting}
              >
                <Ionicons name="close" size={18} color={COLORS.muted} />
              </Pressable>
            </View>

            {!isFirstStep ? <Text style={styles.stepCounter}>{stepTitle}</Text> : null}

            <View style={[styles.pagerClip, { width: bodyWidth }]}>
              <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                bounces={false}
                contentContainerStyle={styles.pagerContent}
                onMomentumScrollEnd={event => {
                  const idx = Math.round(event.nativeEvent.contentOffset.x / bodyWidth);
                  setStep(Math.max(0, Math.min(idx, ONBOARDING_STEPS.length - 1)));
                }}
              >
                {ONBOARDING_STEPS.map((item, index) => (
                  <View key={`slide-${index}`} style={[styles.slide, { width: bodyWidth }]}>
                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      bounces={false}
                      contentContainerStyle={index === 0 ? styles.slideInner : styles.slideInnerDefault}
                    >
                      {index === 0 ? (
                        <>
                          <Text style={[styles.slideTitle, styles.slideTitleHero]} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <View style={[styles.iconBubble, styles.iconBubbleHero]}>
                            <Ionicons name={item.icon ?? 'sparkles-outline'} size={20} color={COLORS.accent2} />
                          </View>
                          {item.text ? <Text style={styles.copy}>{item.text}</Text> : null}
                          {item.bullets?.length ? (
                            <View style={styles.bulletsWrap}>
                              {item.bullets.map((bullet, bulletIndex) => (
                                <View key={`bullet-${index}-${bulletIndex}`} style={styles.bulletRow}>
                                  <View style={styles.bulletDot} />
                                  <Text style={styles.bulletText}>{bullet}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <Text style={styles.slideTitleDefault}>{item.title}</Text>
                          {item.kicker ? <Text style={styles.kicker}>{item.kicker}</Text> : null}
                          {item.text ? (
                            <Text style={[styles.copyDefault, index === 3 && styles.copyDefaultCompact]}>
                              {item.text}
                            </Text>
                          ) : null}
                          {item.bullets?.length ? (
                            <View style={styles.bulletsWrapDefault}>
                              {item.bullets.map((bullet, bulletIndex) => (
                                <View key={`bullet-${index}-${bulletIndex}`} style={styles.bulletRow}>
                                  <View style={styles.bulletDot} />
                                  <Text style={styles.bulletTextDefault}>{bullet}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </>
                      )}
                    </ScrollView>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.dotsRow}>
              {ONBOARDING_STEPS.map((_, index) => (
                <View key={`dot-${index}`} style={[styles.dot, index === step && styles.dotActive]} />
              ))}
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleBack}
                disabled={submitting || isFirstStep}
              >
                <Text style={[styles.secondaryBtnText, isFirstStep && styles.secondaryBtnTextDisabled]}>
                  {t('common.back')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleSkip}
                disabled={submitting}
              >
                <Text style={styles.secondaryBtnText}>{t('common.skip')}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, (pressed || submitting) && styles.pressed]}
                onPress={handleNextOrDone}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {isLastStep ? t('common.done') : isFirstStep ? t('common.start') : t('common.next')}
                  </Text>
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
    backgroundColor: 'rgba(3, 8, 20, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 26,
    backgroundColor: 'rgba(9, 18, 40, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 28,
    gap: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
  },
  headerIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  stepCounter: {
    color: COLORS.muted2,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 0,
  },
  pagerClip: {
    alignSelf: 'center',
    overflow: 'hidden',
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 180,
  },
  pagerContent: {
    alignItems: 'stretch',
  },
  slide: {
    minHeight: 220,
  },
  slideInner: {
    gap: 0,
    paddingBottom: 8,
  },
  slideInnerDefault: {
    gap: 0,
    paddingTop: 20,
    paddingBottom: 8,
    paddingRight: 2,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(93, 187, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 24,
    marginTop: 8,
  },
  slideTitleHero: {
    fontSize: 31,
    lineHeight: 36,
    marginTop: 4,
    marginBottom: 10,
  },
  iconBubbleHero: {
    marginBottom: 12,
  },
  slideTitleDefault: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  kicker: {
    color: COLORS.muted2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 10,
  },
  copyDefault: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
    marginTop: 12,
    maxWidth: '96%',
  },
  copyDefaultCompact: {
    fontSize: 14,
    lineHeight: 21,
  },
  bulletsWrapDefault: {
    gap: 12,
    marginTop: 12,
    paddingRight: 2,
  },
  bulletTextDefault: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  copy: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: 10,
    maxWidth: '92%',
    alignSelf: 'center',
  },
  bulletsWrap: {
    gap: 12,
    marginTop: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: COLORS.accent2,
  },
  bulletText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 24,
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
    marginTop: 24,
  },
  secondaryBtn: {
    flex: 0.9,
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
    flex: 1.25,
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
