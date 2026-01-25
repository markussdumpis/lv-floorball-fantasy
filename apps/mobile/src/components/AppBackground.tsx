import React, { ReactNode, useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

type Props = {
  children: ReactNode;
  variant?: 'home' | 'default';
  intensity?: number;
};

type Bloom = { size: number; top: number; left: number; color: string; opacity: number };

export function AppBackground({ children, variant = 'default', intensity = 1 }: Props) {
  const { width, height } = useWindowDimensions();
  const maxSide = Math.max(width, height);

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

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#05070f', '#040712', '#03040d']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject}>
          {blooms.map((b, idx) => (
            <View
              key={idx}
              style={[
                styles.bloom,
                {
                  width: b.size,
                  height: b.size,
                  top: b.top,
                  left: b.left,
                  backgroundColor: b.color,
                  opacity: b.opacity,
                },
              ]}
            />
          ))}
        </BlurView>
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
});
