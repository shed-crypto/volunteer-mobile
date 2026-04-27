import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { chatApi } from '../../api/chat.api';

type RouteParams = { ChatSettings: { chatId: string; chatName?: string; isGroupChat: boolean } };

export default function ChatSettingsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'ChatSettings'>>();
  const { chatId, chatName, isGroupChat } = route.params;

  const handleDeleteChat = async () => {
    Alert.alert(
      'Видалити чат',
      'Ви впевнені, що хочете видалити цей чат? Це дію не можна скасувати.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: async () => {
            try {
              // TODO: Implement actual delete chat API call
              // await chatApi.deleteChat(chatId);
              Alert.alert('✅', 'Чат видалено (локально)');
              // Повертаємося до списку чатів
              navigation.navigate('Main', { screen: 'Chats', params: { screen: 'ChatsList' } });
            } catch (error: any) {
              Alert.alert('Помилка', 'Не вдалося видалити чат: ' + error.message);
            }
          },
        },
      ],
    );
  };

  const handleClearChat = async () => {
    Alert.alert(
      'Очистити чат',
      'Ви впевнені, що хочете очистити історію цього чату? Повідомлення будуть видалені лише у вас.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Очистити',
          style: 'destructive',
          onPress: async () => {
            try {
              // TODO: Implement actual clear chat API call or local DB deletion
              // await chatApi.clearChatHistory(chatId);
              Alert.alert('✅', 'Історію чату очищено (локально)');
              navigation.goBack();
            } catch (error: any) {
              Alert.alert('Помилка', 'Не вдалося очистити чат: ' + error.message);
            }
          },
        },
      ],
    );
  };

  const handlePinChat = () => {
    // TODO: Implement pinning/unpinning chat logic
    Alert.alert('У розробці', 'Функція закріплення/відкріплення чату буде реалізована пізніше.');
  };

  const handleViewProfile = () => {
    if (!isGroupChat) {
      // Assuming direct chat has only two participants, one is current user
      // Need to fetch the other participant's ID
      // For now, let's just show an alert
      Alert.alert('У розробці', 'Перегляд профілю співрозмовника буде реалізовано пізніше.');
    } else {
      Alert.alert('Недоступно', 'Перегляд профілю окремих учасників доступний лише в особистих чатах.');
    }
  };


  return (
    <View style={styles.container}>
      <ScreenHeader title={chatName ?? 'Налаштування чату'} onBack={() => navigation.goBack()} />

      <View style={styles.settingsSection}>
        <TouchableOpacity style={styles.settingItem} onPress={handlePinChat}>
          <Text style={styles.settingText}>Закріпити чат</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingItem} onPress={handleViewProfile}>
          <Text style={styles.settingText}>Переглянути профіль</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.settingsSection}>
        <TouchableOpacity style={styles.settingItem} onPress={handleClearChat}>
          <Text style={[styles.settingText, styles.destructiveText]}>Очистити історію чату</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingItem} onPress={handleDeleteChat}>
          <Text style={[styles.settingText, styles.destructiveText]}>Видалити чат</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  settingsSection: {
    marginTop: 20,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  settingItem: {
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingText: {
    fontSize: 16,
    color: Colors.text,
  },
  destructiveText: {
    color: Colors.error,
  },
});
