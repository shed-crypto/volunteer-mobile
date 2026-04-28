import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { chatApi } from '../api/chat.api';
import { Chat, ChatType, Message } from '../types';
import { Colors } from '../utils/theme';
import { useAuth } from '../context/AuthContext';

interface ForwardMessageModalProps {
  visible: boolean;
  message: Message | null;
  onClose: () => void;
  onForwarded?: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  visible, message, onClose, onForwarded,
}) => {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadChats = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const data = await chatApi.getMyChats();
      setChats(data);
    } catch {
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => { loadChats(); }, [loadChats]);

  const getChatName = (chat: Chat) => {
    if (chat.name) return chat.name;
    if (chat.type === ChatType.DIRECT) {
      const other = chat.participants?.find((p) => p.id !== user?.id);
      return other?.fullName ?? 'Особистий чат';
    }
    return 'Чат';
  };

  const getChatIcon = (chat: Chat) => {
    if (chat.type === ChatType.TASK_CHAT) return '📌';
    if (chat.type === ChatType.ORG_CHAT) return '🏢';
    return '💬';
  };

  const handleForward = async (targetChat: Chat) => {
    if (!message) return;
    setForwarding(targetChat.id);
    try {
      await chatApi.forwardMessage(
        targetChat.id,
        message.content,
        message.attachmentUrl,
        message.id,
      );
      onForwarded?.();
      onClose();
    } catch (e: any) {
      // Error handled silently
    } finally {
      setForwarding(null);
    }
  };

  const filteredChats = chats.filter((c) => {
    const name = getChatName(c).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Переслати повідомлення</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {message && (
            <View style={styles.messagePreview}>
              <Text style={styles.previewLabel}>Повідомлення:</Text>
              <Text style={styles.previewContent} numberOfLines={2}>
                {message.content}
              </Text>
            </View>
          )}

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Пошук чату..."
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : (
            <FlatList
              data={filteredChats}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>Чатів не знайдено</Text>
                </View>
              }
              renderItem={({ item: chat }) => (
                <TouchableOpacity
                  style={styles.chatRow}
                  onPress={() => handleForward(chat)}
                  disabled={forwarding === chat.id}
                  activeOpacity={0.7}
                >
                  <View style={styles.chatAvatar}>
                    <Text style={{ fontSize: 20 }}>{getChatIcon(chat)}</Text>
                  </View>
                  <View style={styles.chatInfo}>
                    <Text style={styles.chatName} numberOfLines={1}>
                      {getChatName(chat)}
                    </Text>
                    <Text style={styles.chatSub} numberOfLines={1}>
                      {chat.participants?.length ?? 0} учасників
                    </Text>
                  </View>
                  {forwarding === chat.id ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Text style={styles.forwardIcon}>➤</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  messagePreview: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  previewLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  previewContent: {
    fontSize: 14,
    color: Colors.text,
  },
  searchRow: {
    padding: 12,
    backgroundColor: Colors.surface,
  },
  searchInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  chatAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInfo: {
    flex: 1,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  chatSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  forwardIcon: {
    fontSize: 20,
    color: Colors.primary,
  },
});