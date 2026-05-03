import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Image } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { orgsApi } from '../../api/orgs.api';
import { Button, ConfirmDeleteModal, ScreenHeader, LoadingScreen } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { useAuth } from '../../context/AuthContext';
import { Hub, Organization } from '../../types';
import { getMediaUrl } from '../../utils/fileUtils';

type RouteParams = { orgId: string; hubId: string };

export default function HubDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { orgId, hubId } = route.params;
  const { user } = useAuth();

  const [hub, setHub] = useState<Hub | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteVisible, setDeleteVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadHub();
    }, [orgId, hubId]),
  );

  const loadHub = async () => {
    try {
      const [hubs, orgData] = await Promise.all([orgsApi.getHubs(orgId), orgsApi.getOne(orgId)]);
      const found = hubs.find((item) => item.id === hubId) || null;
      setHub(found);
      setOrg(orgData);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося завантажити дані хаба');
    } finally {
      setLoading(false);
    }
  };

  const myMembership = org?.members?.find((member) => member.userId === user?.id);
  const canManage = user?.systemRole === 'admin' || myMembership?.orgRole === 'leader' || myMembership?.orgRole === 'coordinator';

  const handleDelete = async () => {
    if (!hub) return;
    try {
      await orgsApi.deleteHub(orgId, hub.id);
      setDeleteVisible(false);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося видалити хаб');
    }
  };

  if (loading) return <LoadingScreen />;
  if (!hub) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Хаб" onBack={() => navigation.goBack()} />
        <Text style={styles.notFound}>Хаб не знайдено</Text>
      </View>
    );
  }

  const canSeeAddress = hub.isPublic || canManage;
  const mediaUrl = getMediaUrl(hub.mediaUrl);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={hub.name}
        onBack={() => navigation.goBack()}
        rightAction={canManage ? (
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => navigation.navigate('AddHub', { orgId, hubId: hub.id })}>
              <Ionicons name="create-outline" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDeleteVisible(true)}>
              <Ionicons name="trash-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {mediaUrl ? <Image source={{ uri: mediaUrl }} style={styles.media} /> : (
          <View style={styles.mediaFallback}>
            <Ionicons name="cube-outline" size={42} color={Colors.textMuted} />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Опис</Text>
          <Text style={styles.text}>{hub.description || 'Опис відсутній'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Адреса</Text>
          {canSeeAddress ? (
            <Text style={styles.text}>{hub.address || 'Адреса не вказана'}</Text>
          ) : (
            <View style={styles.lockedRow}>
              <Ionicons name="lock-closed" size={16} color={Colors.textMuted} />
              <Text style={styles.lockedText}>Адреса прихована з міркувань безпеки</Text>
            </View>
          )}
        </View>

        {(hub.latitude !== undefined && hub.longitude !== undefined) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Координати</Text>
            <Text style={styles.text}>{hub.latitude}, {hub.longitude}</Text>
          </View>
        ) : null}

        {canManage ? (
          <Button
            title="Видалити хаб"
            variant="danger"
            onPress={() => setDeleteVisible(true)}
            style={styles.deleteButton}
          />
        ) : null}
      </ScrollView>

      <ConfirmDeleteModal
        visible={deleteVisible}
        targetName={hub.name}
        title="Видалити хаб?"
        onClose={() => setDeleteVisible(false)}
        onConfirm={handleDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  headerActions: { flexDirection: 'row', gap: 14 },
  notFound: { color: Colors.text, textAlign: 'center', marginTop: 32 },
  media: { width: '100%', height: 190, borderRadius: 10, marginBottom: 14, backgroundColor: Colors.borderLight },
  mediaFallback: {
    height: 150,
    borderRadius: 10,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  text: { fontSize: 15, color: Colors.textSecondary, lineHeight: 21 },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lockedText: { fontStyle: 'italic', color: Colors.textMuted },
  deleteButton: { marginTop: 8 },
});
