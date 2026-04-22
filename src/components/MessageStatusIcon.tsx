import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

interface MessageStatusIconProps {
  status: 'sent' | 'delivered' | 'read' | 'pending' | 'failed';
  readBy?: string[]; // Масив ID користувачів, які прочитали повідомлення
  deliveredTo?: string[]; // Масив ID користувачів, яким доставлено
}

export const MessageStatusIcon: React.FC<MessageStatusIconProps> = ({ 
  status,
  readBy = [],
  deliveredTo = []
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'sent':
        return '✓';
      case 'delivered':
        return '✓✓';
      case 'read':
        return '👁️';
      case 'pending':
        return '⏳';
      case 'failed':
        return '❌';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'sent':
        return Colors.success;
      case 'delivered':
        return Colors.success;
      case 'read':
        return Colors.primary;
      case 'pending':
        return Colors.warning;
      case 'failed':
        return Colors.error;
      default:
        return Colors.textSecondary;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'sent':
        return 'Надіслано';
      case 'delivered':
        if (deliveredTo.length > 0) {
          return `Доставлено ${deliveredTo.length} ос.`;
        }
        return 'Доставлено';
      case 'read':
        if (readBy.length > 0) {
          return `Прочитано ${readBy.length} ос.`;
        }
        return 'Прочитано';
      case 'pending':
        return 'Очікує';
      case 'failed':
        return 'Помилка';
      default:
        return '';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.icon, { color: getStatusColor() }]}>
        {getStatusIcon()}
      </Text>
      <Text style={[styles.statusText, { color: getStatusColor() }]}>
        {getStatusText()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 60,
  },
  icon: {
    fontSize: 12,
    marginRight: 4,
  },
  statusText: {
    fontSize: 10,
  },
});

export default MessageStatusIcon;
