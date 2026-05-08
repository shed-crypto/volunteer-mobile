import React, { useState, useEffect, useCallback } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { requestsApi } from '../../api/requests.api';
import { Request } from '../../types';
import { Colors } from '../../utils/theme';
import { EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { RequestCard } from './RequestsListScreen';
import { collections } from '../../db';
import { Q } from '@nozbe/watermelondb';
import { useNetwork } from '../../context/NetworkContext';

export default function SavedRequestsScreen() {
  const navigation = useNavigation<any>();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { isOffline } = useNetwork();

  const load = useCallback(async () => {
    try {
      if (isOffline) {
        const saved = await collections.savedRequests.query().fetch();
        setRequests(saved);
      } else {
        const data = await requestsApi.getSaved();
        setRequests(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOffline]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingScreen />;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title="Збережені заявки" onBack={() => navigation.goBack()} />
      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        ListEmptyComponent={<EmptyState icon="🔖" title="Поки що пусто" subtitle="Збережені заявки з'являться тут" />}
        renderItem={({ item }) => (
          <RequestCard 
            request={item} 
            onPress={() => navigation.navigate('RequestDetail', { requestId: item.id })} 
          />
        )}
      />
    </View>
  );
}