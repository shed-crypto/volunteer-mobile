/**
 * NotificationHistoryScreen.tsx
 * -----------------------------
 * Екран історії сповіщень / подій.
 * Показує всі sync_events у зворотному хронологічному порядку.
 * Можна використовувати не тільки для синхронізації, але й для
 * будь-яких системних сповіщень у майбутньому.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Card, Button } from '../../components/ui';
import { collections, database } from '../../db/index';
import { SyncEventLogger } from '../../services/SyncEventLogger';

interface EventItem {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  isError: boolean;
  isRead: boolean;
  createdAt: number;
}

function getIcon(eventType: string): string {
  switch (eventType) {
    case 'sync_success':   return '✅';
    case 'sync_error':     return '❌';
    case 'sync_conflict':  return '⚠️';
    case 'offline_enqueue':return '⏳';
    case 'queue_failed':   return '🚫';
    case 'sync_retry':     return '🔄';
    default:               return '📌';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) +
    ', ' + d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'numeric' });
}

export default function NotificationHistoryScreen() {
  const navigation: any = useNavigation();
  const [events, setEvents] = useState<EventItem[]>([]);

  const loadEvents = useCallback(async () => {
    try {
      const all = await collections.syncEvents.query().fetch();
      const sorted = all
        .sort((a: any, b: any) => b.createdAt - a.createdAt)
        .map((e: any) => ({
          id: e.id,
          eventType: e.eventType,
          title: e.title,
          description: e.description,
          isError: e.isError,
          isRead: e.isRead,
          createdAt: e.createdAt,
        }));
      setEvents(sorted);
    } catch (e) {
      console.warn('[NotificationHistory] load failed', e);
    }
  }, []);

  useEffect(() => {
    loadEvents();
    const interval = setInterval(loadEvents, 5000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  const handleClear = async () => {
    await SyncEventLogger.clearAll();
    setEvents([]);
  };

  const handleMarkRead = async () => {
    await SyncEventLogger.markAllRead();
    setEvents(prev => prev.map(e => ({ ...e, isRead: true })));
  };

  const renderItem = ({ item }: { item: EventItem }) => (
    <Card style={(!item.isRead ? { ...styles.card, ...styles.unread } : styles.card) as ViewStyle}>
      <View style={styles.cardRow}>
        <Text style={styles.icon}>{getIcon(item.eventType)}</Text>
        <View style={styles.cardContent}>
          <Text style={[styles.title, !item.isRead && styles.titleUnread]}>
            {item.title}
          </Text>
          {item.description && (
            <Text style={styles.description}>{item.description}</Text>
          )}
          <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
        </View>
      </View>
    </Card>
  );

  const unreadCount = events.filter(e => !e.isRead).length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title="🔔 Сповіщення" onBack={() => navigation.goBack()} />
      
      {events.length > 0 && (
        <View style={styles.actions}>
          <Button
            title={`🔄 Позначити прочитаними (${unreadCount})`}
            variant="outline"
            size="sm"
            onPress={handleMarkRead}
            disabled={unreadCount === 0}
            style={{ marginRight: 8 }}
          />
          <Button
            title="🗑 Очистити"
            variant="outline"
            size="sm"
            onPress={handleClear}
          />
        </View>
      )}

      <FlatList
        data={events}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔔</Text>
            <Text style={styles.emptyText}>Немає сповіщень</Text>
            <Text style={styles.emptySubtext}>
              Тут з'являтимуться сповіщення про синхронізацію,{'\n'}
              помилки та інші події
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 8,
  },
  unread: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    backgroundColor: '#F0F8FF',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    fontSize: 20,
    marginTop: 2,
  },
  cardContent: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 4,
  },
  titleUnread: {
    fontWeight: '800',
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  time: {
    fontSize: 11,
    color: '#9E9E9E',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.background,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});