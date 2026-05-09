/**
 * ChatsListScreen.tsx
 *
 * Доповнення: повноцінний месенджер.
 * - Кнопка "Новий чат" → пошук по всіх юзерах → відкрити direct чат
 * - Показуємо тип чату (задача/організація/особистий)
 * - Останнє повідомлення та час
 * - Непрочитані через WebSocket
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, StyleSheet, Modal,
  TextInput, ActivityIndicator, Image
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { chatApi } from '../../api/chat.api';
import { usersApi } from '../../api/users.api';
import { Chat, ChatType, Message, User } from '../../types';
import { Colors } from '../../utils/theme';
import { EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { collections, database } from '../../db/index';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

interface UserItem {
  id: string;
  fullName: string;
  email: string;
  systemRole: string;
}

export default function ChatsListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();

  const [chats, setChats]           = useState<Chat[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadMap, setUnreadMap]   = useState<Record<string, number>>({});
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [hasError, setHasError] = useState(false);

  // New chat modal
  const [showNewChat, setShowNewChat]   = useState(false);
  const [userSearch, setUserSearch]     = useState('');
  const [allUsers, setAllUsers]         = useState<UserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [creatingChat, setCreatingChat] = useState<string | null>(null);
  const { isOffline } = useNetwork();

  useEffect(() => {
    const fetchSearchResults = async () => {
      if (userSearch.length < 2) {
        setAllUsers([]);
        return;
      }
      if (isOffline) {
        setAllUsers([]);
        return;
      }
      setUsersLoading(true);
      try {
        const users = await usersApi.search(userSearch);
        setAllUsers(users.map((u: User) => ({
          id: u.id,
          fullName: u.fullName ?? '',
          email: '',
          systemRole: ''
        })).filter((u: UserItem) => u.id !== user?.id));
      } catch (error: any) {
        if (error?.response) {
          console.error('Failed to search users:', error);
        } else {
          OfflineLogger.network('User search skipped: server unavailable');
        }
        setAllUsers([]);
      } finally {
        setUsersLoading(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      fetchSearchResults();
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [userSearch, user?.id, isOffline]);

  // ─── Load chats from local DB ────────────────────────────────────────────
  const loadChatsLocal = useCallback(async (): Promise<Chat[]> => {
    try {
      let localChats: any[] = [];
      try {
        localChats = await collections.chats.query().fetch();
      } catch (dbErr: any) {
        if (dbErr.message?.includes('no such table')) {
          OfflineLogger.cache('ChatsList: chats table not found (migration pending)');
          return [];
        }
        throw dbErr;
      }
      if (localChats.length === 0) return [];
      
      const mapped = localChats.map((c: any) => ({
        id: c.serverId,
        name: c.name,
        type: c.type as ChatType,
        participants: c.participants,
        lastMessage: c.lastMessage,
        unreadCount: c.unreadCount,
        updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : undefined,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : undefined,
      })) as Chat[];
      
      OfflineLogger.cache(`ChatsList: loaded ${mapped.length} chats from DB`);
      return mapped;
    } catch (e) {
      OfflineLogger.cache('ChatsList: local DB load failed', e);
      return [];
    }
  }, []);

  // ─── Save chats to local DB ──────────────────────────────────────────────
  const saveChatsToDB = useCallback(async (chatsData: Chat[]) => {
    try {
      const existing = (await collections.chats.query().fetch()) as any[];
      const serverIds = new Set(chatsData.map(c => c.id));
      const existingMap = new Map(existing.map((c: any) => [c.serverId, c]));
      const operations: any[] = [];

      // 1. Видалити локальні чати, яких немає на сервері (синхронізація видалених)
      for (const localChat of existing) {
        if (!serverIds.has(localChat.serverId)) {
          operations.push(localChat.prepareMarkAsDeleted());
        }
      }

      // 2. Оновити або створити чати з сервера
      for (const chat of chatsData) {
        const existingChat = existingMap.get(chat.id);
        if (existingChat) {
          operations.push(
            existingChat.prepareUpdate((c: any) => {
              c.name = chat.name ?? null;
              c.type = chat.type;
              c.participantsRaw = JSON.stringify(chat.participants ?? []);
              c.lastMessageRaw = chat.lastMessage ? JSON.stringify(chat.lastMessage) : null;
              c.unreadCount = chat.unreadCount ?? 0;
              c.updatedAt = chat.updatedAt ? new Date(chat.updatedAt).getTime() : Date.now();
              c.isSynced = true;
              c.lastSyncedAt = Date.now();
            })
          );
        } else {
          operations.push(
            collections.chats.prepareCreate((c: any) => {
              c.serverId = chat.id;
              c.name = chat.name ?? null;
              c.type = chat.type;
              c.participantsRaw = JSON.stringify(chat.participants ?? []);
              c.lastMessageRaw = chat.lastMessage ? JSON.stringify(chat.lastMessage) : null;
              c.unreadCount = chat.unreadCount ?? 0;
              c.updatedAt = chat.updatedAt ? new Date(chat.updatedAt).getTime() : Date.now();
              c.isSynced = true;
              c.lastSyncedAt = Date.now();
            })
          );
        }
      }

      if (operations.length > 0) {
        await database.write(async () => {
          await database.batch(...operations);
        });
        OfflineLogger.cache(`ChatsList: synced ${operations.length} operations to DB`);
      }
    } catch (e) {
      OfflineLogger.cache('ChatsList: save to DB failed', e);
    }
  }, []);

  const saveChatMessagesToDB = useCallback(async (chatId: string, messages: Message[]) => {
    if (!messages.length) return;
    try {
      const existing = await collections.chatMessages.query().fetch();
      const existingForChat = existing.filter((m: any) => m.chatId === chatId);
      const operations: any[] = [];

      for (const msg of messages) {
        if (existingForChat.some((m: any) => m.serverId === msg.id)) continue;
        operations.push(
          collections.chatMessages.prepareCreate((m: any) => {
            m.serverId = msg.id;
            m.chatId = msg.chatId;
            m.senderId = msg.senderId || '';
            m.senderName = msg.sender?.fullName || null;
            m.content = msg.content || '';
            m.sentAt = typeof msg.sentAt === 'string' ? new Date(msg.sentAt).getTime() : msg.sentAt;
            m.isSynced = true;
            m.pendingAction = null;
            m.messageType = (msg as any).messageType || 'text';
            m.attachmentUrl = (msg as any).attachmentUrl || null;
            m.messageStatus = (msg as any).messageStatus || 'sent';
            m.readByRaw = JSON.stringify((msg as any).readBy || []);
            m.deliveredToRaw = JSON.stringify((msg as any).deliveredTo || []);
            m.replyToId = msg.replyToId || null;
            m.lastSyncedAt = Date.now();
          })
        );
      }

      if (operations.length > 0) {
        await database.write(async () => {
          await database.batch(...operations);
        });
      }
    } catch (e) {
      OfflineLogger.cache('ChatsList: message prefetch save failed', e);
    }
  }, []);

  const prefetchRecentChatMessages = useCallback(async (chatsData: Chat[]) => {
    for (const chat of chatsData.slice(0, 10)) {
      try {
        const latest = await chatApi.getLatestMessages(chat.id, 25);
        await saveChatMessagesToDB(chat.id, latest);
      } catch {
        // Best-effort cache warmup only.
      }
    }
  }, [saveChatMessagesToDB]);

  const load = useCallback(async () => {
    setHasError(false);
    OfflineLogger.nav('ChatsListScreen.load() called');

    try {
      // КРОК 1: Load from local DB first (with ADAPTIVE timeout)
      const timeout = isOffline ? 10000 : 300;
      const localData = await Promise.race([
        loadChatsLocal(),
        new Promise<Chat[]>((resolve) => setTimeout(() => {
          OfflineLogger.cache(`ChatsList: local DB timeout (${timeout}ms)`);
          resolve([]);
        }, timeout))
      ]);
      
      if (localData.length > 0) {
        OfflineLogger.nav('ChatsList: showing local data first');
        setChats(localData);
      }

      // КРОК 2: If online, update from server AND save to DB
      if (!isOffline) {
        try {
          const data = await chatApi.getMyChats();
          
          // Мержимо серверні дані з локальними (зберігаємо локальні які ще не синхронізувалися)
          if (data && data.length > 0) {
            // Використовуємо серверні дані як основу
            setChats(data);
          }
          setIsOfflineMode(false);
          OfflineLogger.nav(`ChatsList: loaded ${data.length} from server`);
          
          // ЗБЕРЕГТИ в БД для офлайн-роботи
          await saveChatsToDB(data);
          await prefetchRecentChatMessages(data);
        } catch (error) {
          OfflineLogger.network('ChatsList: server load failed, keeping local data');
          // Не скидаємо стан, залишаємо локальні дані
          setHasError(true);
        }
      } else {
        setIsOfflineMode(true);
        OfflineLogger.nav('ChatsList: offline — showing cached data');
      }
    } catch (e) {
      OfflineLogger.nav('ChatsList: unexpected error', e);
      setHasError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOffline, loadChatsLocal, saveChatsToDB, prefetchRecentChatMessages]);

  useEffect(() => { load(); }, [load]);

  // WebSocket: нові повідомлення → збільшуємо лічильник
  useSocket({
    onNewMessage: (msg: Message & { senderName: string }) => {
      setUnreadMap((prev) => ({
        ...prev,
        [msg.chatId]: (msg.senderId !== user?.id) ? (prev[msg.chatId] ?? 0) + 1 : prev[msg.chatId] ?? 0,
      }));
      
      // Оновлюємо стан чатів локально (додаємо нове повідомлення в прев'ю)
      setChats(prevChats => prevChats.map(c => {
        if (c.id === msg.chatId) {
          return { ...c, lastMessage: msg, updatedAt: msg.sentAt };
        }
        return c;
      }));
    },
  });

  const handleOpenChat = (chat: Chat) => {
    setUnreadMap((prev) => ({ ...prev, [chat.id]: 0 }));
    chatApi.markAsRead(chat.id).catch(() => {});
    
    // Відкриваємо чат простим переходом
    navigation.navigate('ChatRoom', {
      chatId: chat.id,
      chatName: getChatName(chat)
    });
  };

  // ─── Пошук юзерів для нового чату ────────────────────────────────────────

  const openNewChatModal = () => {
    setShowNewChat(true);
    setUserSearch('');
    setAllUsers([]);
  };

  const handleStartChat = async (targetUser: UserItem) => {
    setCreatingChat(targetUser.id);
    try {
      const chat = await chatApi.getOrCreateDirect(targetUser.id);
      setShowNewChat(false);
      await load();
      navigation.navigate('ChatRoom', {
        chatId:   chat.id,
        chatName: targetUser.fullName,
      });
    } catch {
      // ignore
    } finally {
      setCreatingChat(null);
    }
  };

  const filteredUsers = allUsers.filter((u) =>
    u.fullName.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()),
  );

  if (loading && chats.length === 0) return <LoadingScreen />;

  const getChatName = (chat: Chat) => {
    if (chat.name) return chat.name;
    if (chat.type === ChatType.DIRECT) {
      const other = chat.participants?.find((p) => p.id !== user?.id);
      return other?.fullName ?? 'Особистий чат';
    }
    return 'Чат';
  };

  const getLastMessagePreview = (chat: Chat) => {
    if (!chat.lastMessage) return '';
    const msg = chat.lastMessage;
    if (msg.messageType === 'system') return msg.content;
    if (msg.attachmentUrl) {
      const isImage = msg.attachmentUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|heic)/i);
      return isImage ? '🖼 Фото' : '📎 Файл';
    }
    return msg.content || '';
  };

  const getChatIcon = (chat: Chat) => {
    if (chat.type === ChatType.TASK_CHAT) return '📌';
    if (chat.type === ChatType.ORG_CHAT)  return '🏢';
    return '💬';
  };

  const getChatColor = (chat: Chat) => {
    if (chat.type === ChatType.TASK_CHAT) return '#E3F2FD';
    if (chat.type === ChatType.ORG_CHAT)  return '#E8F5E9';
    return Colors.primaryLight;
  };

  const totalUnread = Object.values(unreadMap).reduce((a, b) => a + b, 0);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Чати"
        subtitle={totalUnread > 0 ? `${totalUnread} нових` : `${chats.length} активних`}
        rightAction={
          <TouchableOpacity style={styles.newChatBtn} onPress={openNewChatModal}>
            <Text style={styles.newChatBtnText}>✏️</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        ListEmptyComponent={
          <EmptyState
            icon="💬"
            title="Чатів немає"
            subtitle={'Натисніть ✏️ щоб написати комусь особисто.\nЧати задач створюються автоматично.'}
          />
        }
        renderItem={({ item: chat }) => {
          const unread = unreadMap[chat.id] ?? 0;
          return (
            <TouchableOpacity
              style={styles.chatRow}
              onPress={() => handleOpenChat({ ...chat, id: chat.id || (chat as any).serverId })}
              activeOpacity={0.75}
            >
              <View style={[styles.avatar, { backgroundColor: getChatColor(chat) }]}>
                <Text style={{ fontSize: 22 }}>{getChatIcon(chat)}</Text>
              </View>

              <View style={styles.chatInfo}>
                <View style={styles.chatHeader}>
                  <Text
                    style={[styles.chatName, unread > 0 && styles.chatNameUnread]}
                    numberOfLines={1}
                  >
                    {getChatName(chat)}
                  </Text>
                  <Text style={styles.chatTime}>
                    {chat.updatedAt
                      ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true, locale: uk })
                      : ''}
                  </Text>
                </View>
                <Text style={styles.chatSub} numberOfLines={1}>
                  {getLastMessagePreview(chat) || (
                    chat.type === ChatType.DIRECT   ? 'Особистий чат'
                    : chat.type === ChatType.TASK_CHAT ? '📌 Чат задачі'
                    : chat.type === ChatType.ORG_CHAT  ? '🏢 Чат організації'
                    : `${chat.participants?.length ?? 0} учасників`
                  )}
                </Text>
              </View>

              {unread > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
      />

      {/* ─── Модалка нового чату ──────────────────────────────────────────── */}
      <Modal
        visible={showNewChat}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNewChat(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Новий чат</Text>
            <TouchableOpacity onPress={() => setShowNewChat(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalSearch}>
            <TextInput
              style={styles.searchInput}
              value={userSearch}
              onChangeText={setUserSearch}
              placeholder="🔍 Пошук за ім'ям або email..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
          </View>

          {usersLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : (
            <FlatList
              data={allUsers}
              keyExtractor={(u) => u.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text style={{ fontSize: 36, marginBottom: 8 }}>👤</Text>
                  <Text style={{ color: Colors.textMuted }}>Користувачів не знайдено</Text>
                </View>
              }
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.borderLight }} />}
              renderItem={({ item: u }) => (
                <TouchableOpacity
                  style={styles.userRow}
                  onPress={() => handleStartChat(u)}
                  disabled={creatingChat === u.id}
                  activeOpacity={0.7}
                >
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarText}>{u.fullName[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{u.fullName}</Text>
                    <Text style={styles.userEmail}>{u.email}</Text>
                  </View>
                  {creatingChat === u.id ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Text style={styles.chatArrow}>💬</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  newChatBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  newChatBtnText: { fontSize: 18 },

  chatRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface, gap: 12,
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
  },
  chatInfo:       { flex: 1 },
  chatHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  chatName:       { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },
  chatNameUnread: { fontWeight: '800' },
  chatTime:       { fontSize: 12, color: Colors.textMuted },
  chatSub:        { fontSize: 13, color: Colors.textSecondary, marginTop: 3 },
  divider:        { height: 1, backgroundColor: Colors.borderLight, marginLeft: 78 },
  unreadBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  modalClose: { fontSize: 20, color: Colors.textMuted, padding: 4 },
  modalSearch: { padding: 12, backgroundColor: Colors.surface },
  searchInput: {
    backgroundColor: Colors.background, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.border,
  },

  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  userAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  userAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  userName:       { fontSize: 15, fontWeight: '600', color: Colors.text },
  userEmail:      { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  chatArrow:      { fontSize: 20 },
});
