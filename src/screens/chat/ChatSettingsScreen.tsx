import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { chatApi } from '../../api/chat.api';
import { Q } from '@nozbe/watermelondb';
import { database, collections, safeWrite } from '../../db/index';

type RouteParams = { ChatSettings: { chatId: string; chatName?: string; isGroupChat: boolean; participantUserId?: string } };

export default function ChatSettingsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'ChatSettings'>>();
  const { chatId, chatName, isGroupChat, participantUserId } = route.params;

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
              await chatApi.deleteChat(chatId);
              // Додатково видаляємо локальні повідомлення в БД
              await safeWrite(async () => {
                const msgs = await collections.chatMessages.query(Q.where('chat_id', chatId)).fetch();
                await database.batch(...msgs.map((m: any) => m.prepareDestroyPermanently()));
                const allChats = await collections.chats.query().fetch();
                const chat = allChats.find((item: any) => item.serverId === chatId || item.id === chatId);
                if (chat) {
                  await chat.markAsDeleted();
                }
              });
              Alert.alert('✅', 'Чат видалено');
              navigation.goBack();
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
              await chatApi.clearChatHistory(chatId);
              await safeWrite(async () => {
                const msgs = await collections.chatMessages.query(Q.where('chat_id', chatId)).fetch();
                await database.batch(...msgs.map((m: any) => m.prepareDestroyPermanently()));
              });
              Alert.alert('✅', 'Історію чату очищено');
              navigation.goBack();
            } catch (error: any) {
              Alert.alert('Помилка', 'Не вдалося очистити чат: ' + error.message);
            }
          },
        },
      ],
    );
  };

  const handlePinChat = async () => {
    try {
      await chatApi.togglePin(chatId);
      Alert.alert('✅', 'Статус чату оновлено');
    } catch (error: any) {
      Alert.alert('Помилка', 'Не вдалося закріпити чат: ' + error.message);
    }
  };

  const handleViewProfile = () => {
    if (participantUserId) {
      navigation.navigate('UserProfile', { userId: participantUserId });
    } else if (!isGroupChat) {
      Alert.alert('Недоступно', 'ID співрозмовника не знайдено. Спробуйте натиснути на аватар у чаті.');
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
