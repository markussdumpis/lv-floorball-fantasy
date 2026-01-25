import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

export function PremiumBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#050712', '#0c142b']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.blobs}>
        <View style={[styles.blob, styles.blobPink]} />
        <View style={[styles.blob, styles.blobPurple]} />
        <View style={[styles.blob, styles.blobCyan]} />
      </View>

      <BlurView tint="dark" intensity={25} style={StyleSheet.absoluteFill} />

      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  blobs: {
    ...StyleSheet.absoluteFillObject,
  },
  blob: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    opacity: 0.18,
  },
  blobPink: {
    backgroundColor: '#ff4d5e',
    top: -180,
    right: -140,
  },
  blobPurple: {
    backgroundColor: '#7b61ff',
    top: 160,
    left: -200,
  },
  blobCyan: {
    backgroundColor: '#4ed0ff',
    bottom: -200,
    right: -120,
    opacity: 0.12,
  },
});
