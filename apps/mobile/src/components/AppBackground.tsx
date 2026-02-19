import React, { ReactNode, useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

type Props = {
  children: ReactNode;
  variant?: 'home' | 'default' | 'auth';
  intensity?: number;
};

type Bloom = { size: number; top: number; left: number; color: string; opacity: number };
type Beam = {
  width: number;
  height: number;
  top: number;
  left: number;
  rotate: string;
  colors: string[];
  opacity: number;
};

export function AppBackground({ children, variant = 'default', intensity = 1 }: Props) {
  const { width, height } = useWindowDimensions();
  const maxSide = Math.max(width, height);
  // unified look across all screens

  const blooms: Bloom[] = useMemo(() => {
    const base: Bloom[] = [
      { size: maxSide * 0.75, top: -maxSide * 0.25, left: width * 0.6, color: 'rgba(156, 71, 255, 1)', opacity: 0.18 },
      { size: maxSide * 0.65, top: height * 0.35, left: width * 0.05, color: 'rgba(74, 144, 226, 1)', opacity: 0.16 },
      { size: maxSide * 0.55, top: height * 0.65, left: -width * 0.25, color: 'rgba(255, 99, 146, 1)', opacity: 0.14 },
    ];

    if (variant === 'home') {
      base[0].left = width * 0.7;
      base[1].left = width * 0.1;
      base[2].left = -width * 0.2;
    }

    return base.map(b => ({ ...b, opacity: b.opacity * intensity }));
  }, [height, width, maxSide, variant, intensity]);

  const beams: Beam[] = useMemo(() => {
    const beamScale = 1;

    const long = maxSide * 1.35;
    const thick = Math.max(32, maxSide * 0.12);

    return [
      {
        width: long,
        height: thick,
        top: -maxSide * 0.08,
        left: -maxSide * 0.25,
        rotate: '-12deg',
        colors: ['rgba(90, 190, 255, 0.32)', 'rgba(255, 255, 255, 0.16)'],
        opacity: 0.8 * beamScale,
      },
      {
        width: long * 0.9,
        height: thick * 0.9,
        top: height * 0.28,
        left: width * -0.05,
        rotate: '-18deg',
        colors: ['rgba(60, 220, 205, 0.28)', 'rgba(86, 176, 255, 0.18)'],
        opacity: 0.75 * beamScale,
      },
      {
        width: long,
        height: thick * 0.75,
        top: height * 0.62,
        left: width * -0.15,
        rotate: '-24deg',
        colors: ['rgba(255, 180, 120, 0.22)', 'rgba(255, 255, 255, 0.1)'],
        opacity: 0.7 * beamScale,
      },
      {
        width: long * 1.05,
        height: thick * 0.65,
        top: height * 0.48,
        left: width * 0.25,
        rotate: '-6deg',
        colors: ['rgba(92, 255, 224, 0.22)', 'rgba(126, 188, 255, 0.18)'],
        opacity: 0.76 * beamScale,
      },
      {
        width: long * 0.95,
        height: thick * 0.7,
        top: height * 0.14,
        left: width * 0.35,
        rotate: '16deg',
        colors: ['rgba(40, 210, 255, 0.28)', 'rgba(120, 230, 255, 0.2)'],
        opacity: 0.78 * beamScale,
      },
      {
        width: long * 1.1,
        height: thick * 0.78,
        top: height * 0.78,
        left: width * -0.32,
        rotate: '28deg',
        colors: ['rgba(255, 120, 180, 0.24)', 'rgba(255, 248, 200, 0.16)'],
        opacity: 0.72 * beamScale,
      },
      {
        width: long * 0.8,
        height: thick * 0.62,
        top: height * 0.38,
        left: width * 0.55,
        rotate: '-38deg',
        colors: ['rgba(255, 255, 255, 0.2)', 'rgba(76, 210, 255, 0.24)'],
        opacity: 0.68 * beamScale,
      },
      {
        width: long * 0.88,
        height: thick * 0.7,
        top: height * 0.02,
        left: width * -0.18,
        rotate: '34deg',
        colors: ['rgba(32, 255, 206, 0.24)', 'rgba(32, 110, 255, 0.18)'],
        opacity: 0.68 * beamScale,
      },
    ].map(beam => ({ ...beam, opacity: beam.opacity * intensity }));
  }, [height, width, maxSide, variant, intensity]);

  const baseGradient = useMemo(() => {
    return ['#041222', '#04192d', '#020c18'];
  }, []);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={baseGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFillObject}>
          {(
            <LinearGradient
              colors={['rgba(32, 220, 255, 0.22)', 'rgba(0, 0, 0, 0)', 'rgba(26, 180, 140, 0.18)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.wash,
                {
                  width: maxSide * 1.4,
                  height: maxSide * 1.0,
                  top: -maxSide * 0.05,
                  left: -maxSide * 0.2,
                  opacity: 0.8,
                },
              ]}
            />
          )}
          {(
            <LinearGradient
              colors={['rgba(180, 255, 255, 0.12)', 'rgba(0, 0, 0, 0)']}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={[
                styles.topWash,
                {
                  width: maxSide * 1.1,
                  height: maxSide * 0.55,
                  top: -maxSide * 0.15,
                  left: -maxSide * 0.05,
                  opacity: 0.9,
                },
              ]}
            />
          )}
          {beams.map((beam, idx) => (
                <LinearGradient
                  key={idx}
                  colors={beam.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.beam,
                    {
                      width: beam.width,
                      height: beam.height,
                      top: beam.top,
                      left: beam.left,
                      opacity: beam.opacity,
                      transform: [{ rotate: beam.rotate }],
                    },
                  ]}
                />
              ))}
        </BlurView>
        {
          <BlurView
            intensity={68}
            tint="dark"
            style={[StyleSheet.absoluteFillObject, styles.softener, { opacity: 1 }]}
          />
        }
      </View>

      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.5)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  bloom: {
    position: 'absolute',
    borderRadius: 9999,
  },
  beam: {
    position: 'absolute',
    borderRadius: 999,
  },
  wash: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.8,
  },
  softener: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  topWash: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.9,
  },
});
