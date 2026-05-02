import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { orgsApi } from '../../api/orgs.api';
import { Button, ScreenHeader, Card, LoadingScreen } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { useAuth } from '../../context/AuthContext';
import { Hub } from '../../types';

type RouteParams = { orgId: string; hubId: string };

export default function HubDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { orgId, hubId } = route.params;
  const { user } = useAuth();

  const [hub, setHub] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHub();
  }, []);

  const loadHub = async () => {
    try {
      const data = await orgsApi.getHubs(orgId);
      const found = data.find(h => h.id === hubId);
      setHub(found || null);
    } catch {
      Alert.alert('Помилка', 'Не вдалося завантажити дані хабу');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!hub) return <View style={styles.container}><Text>Хаб не знайдено</Text></View>;

  // Логіка доступу до адреси
  const canSeeAddress = hub.isPublic || user?.systemRole === 'admin'; // Спрощена логіка

  return (
    <View style={styles.container}>
      <ScreenHeader title={hub.name} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>Опис</Text>
          <Text style={styles.text}>{hub.description || 'Опис відсутній'}</Text>
          
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Адреса</Text>
          {canSeeAddress ? (
            <Text style={styles.text}>{hub.address || 'Адреса не вказана'}</Text>
          ) : (
            <View style={styles.lockedRow}>
              <Ionicons name="lock-closed" size={16} color={Colors.textMuted} />
              <Text style={styles.lockedText}>Адреса прихована з міркувань безпеки</Text>
            </View>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  text: { fontSize: 15, color: Colors.text },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lockedText: { fontStyle: 'italic', color: Colors.textMuted }
});