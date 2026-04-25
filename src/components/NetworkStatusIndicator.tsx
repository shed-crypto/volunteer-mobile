import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';
import { useNetwork } from '../context/NetworkContext';

export const NetworkStatusIndicator: React.FC = () => {
  const { isConnected, isServerReachable } = useNetwork();
  
  // isConnected = є мережа (WiFi/мобільна)
  // isServerReachable = сервер відповідає на ping
  const isFullyOnline = isConnected && isServerReachable;
  
  // Якщо є мережа але сервер недоступний — жовтий індикатор
  const indicatorColor = isFullyOnline 
    ? Colors.success 
    : isConnected 
      ? Colors.warning  // Сервер недоступний, але є мережа
      : Colors.error;   // Немає мережі
      
  const statusText = isFullyOnline 
    ? 'Онлайн' 
    : isConnected 
      ? 'Сервер недоступний' 
      : 'Офлайн';

  return (
    <View style={styles.container}>
      <View style={[styles.indicator, { backgroundColor: indicatorColor }]} />
      <Text style={[styles.statusText, { color: indicatorColor }]}>
        {statusText}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    color: Colors.text,
  },
});

export default NetworkStatusIndicator;