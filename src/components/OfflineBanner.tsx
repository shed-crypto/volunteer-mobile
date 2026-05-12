import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../utils/theme';

/**
 * OfflineBanner — показує банер зверху екрана при втраті/відновленні з'єднання.
 * Синхронізацію при реконекті тригерить NetworkContext, не це компонент.
 */
export function OfflineBanner() {
  const { isOnline, wasOffline } = useNetworkStatus();
  const slideAnim = useRef(new Animated.Value(-50)).current;
  const [visible, setVisible] = React.useState(false);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      Animated.spring(slideAnim, {
        toValue: 0, useNativeDriver: true, tension: 80, friction: 10,
      }).start();
    } else if (wasOffline && isOnline) {
      setVisible(true);
      setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: -50, useNativeDriver: true, duration: 300,
        }).start(() => setVisible(false));
      }, 2500);
    } else {
      Animated.timing(slideAnim, {
        toValue: -50, useNativeDriver: true, duration: 300,
      }).start(() => setVisible(false));
    }
  }, [isOnline, wasOffline]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          transform: [{ translateY: slideAnim }],
          backgroundColor: isOnline ? Colors.secondary : Colors.danger,
        },
      ]}
    >
      <Text style={styles.text}>
        {!isOnline
          ? '📵 Немає інтернету — режим офлайн'
          : '✅ З\'єднання відновлено'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999,
    paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, elevation: 8,
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
});
