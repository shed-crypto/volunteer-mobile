import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

interface NetworkStatusIndicatorProps {
  isOnline: boolean;
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({ 
  isOnline
}) => {
  return (
    <View style={styles.container}>
      <View style={[styles.indicator, { backgroundColor: isOnline ? Colors.success : Colors.error }]} />
      <Text style={styles.statusText}>
        {isOnline ? 'Онлайн' : 'Офлайн'}
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