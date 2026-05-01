import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, Alert, TouchableOpacity
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { orgsApi } from '../../api/orgs.api';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Card, EmptyState, LoadingScreen, Button } from '../../components/ui';
import { OrganizationJoinRequest } from '../../types';

export default function JoinRequestsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { orgId } = route.params;

  const [requests, setRequests] = useState<OrganizationJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const data = await orgsApi.getJoinRequests(orgId);
      setRequests(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (requestId: string, approve: boolean) => {
    setProcessingId(requestId);
    try {
      if (approve) {
        await orgsApi.approveRequest(orgId, requestId);
      } else {
        await orgsApi.rejectRequest(orgId, requestId);
      }
      Alert.alert('Успіх', approve ? 'Запит схвалено' : 'Запит відхилено');
      loadRequests();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося обробити запит');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Запити на вступ" onBack={() => navigation.goBack()} />
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="✉️"
            title="Запитів немає"
            subtitle="Тут з'являться нові запити на вступ"
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={{ fontSize: 18 }}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{item.user?.fullName || 'Анонімний користувач'}</Text>
                <Text style={styles.status}>Статус: {item.status}</Text>
              </View>
            </View>

            {item.message && (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>"{item.message}"</Text>
              </View>
            )}

            {item.status === 'pending' && (
              <View style={styles.actions}>
                <Button
                  title="Відхилити"
                  onPress={() => handleAction(item.id, false)}
                  variant="outline"
                  size="sm"
                  style={{ flex: 1 }}
                  loading={processingId === item.id}
                />
                <Button
                  title="Схвалити"
                  onPress={() => handleAction(item.id, true)}
                  size="sm"
                  style={{ flex: 1 }}
                  loading={processingId === item.id}
                />
              </View>
            )}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  card: { marginBottom: 12, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  userName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  status: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  messageBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  messageText: { fontSize: 14, color: Colors.textSecondary, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
});