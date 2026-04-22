import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

interface SyncStatusIndicatorProps {
  status: 'synced' | 'pending' | 'failed' | 'syncing';
  lastSyncedAt?: number | null;
  style?: any;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({ 
  status, 
  lastSyncedAt,
  style 
}) => {
  const getStatusText = () => {
    switch (status) {
      case 'synced':
        return 'Синхронізовано';
      case 'pending':
        return 'Очікує синхронізації';
      case 'failed':
        return 'Помилка синхронізації';
      case 'syncing':
        return 'Синхронізація...';
      default:
        return 'Невідомо';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'synced':
        return Colors.success;
      case 'pending':
        return Colors.warning;
      case 'failed':
        return Colors.error;
      case 'syncing':
        return Colors.primary; // Використовуємо primary замість info
      default:
        return Colors.textSecondary;
    }
  };

  const formatLastSynced = () => {
    if (!lastSyncedAt) return '';
    const date = new Date(lastSyncedAt);
    return `Остання синхронізація: ${date.toLocaleString('uk-UA')}`;
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.statusText, { color: getStatusColor() }]}>
        {getStatusText()}
      </Text>
      {lastSyncedAt && (
        <Text style={styles.lastSyncedText}>
          {formatLastSynced()}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  lastSyncedText: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});

export default SyncStatusIndicator;