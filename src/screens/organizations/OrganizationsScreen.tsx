import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { orgsApi } from '../../api/orgs.api';
import { Organization } from '../../types';
import { Colors } from '../../utils/theme';
import { Button, Card, EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { SystemRole } from '../../types';

export default function OrganizationsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [orgs, setOrgs]           = useState<Organization[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]     = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [creating, setCreating]   = useState(false);

  const load = async () => {
    try {
      const data = await orgsApi.getAll();
      setOrgs(data);
    } catch {
      setOrgs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { Alert.alert('', 'Введіть назву'); return; }
    setCreating(true);
    try {
      await orgsApi.create({ name: newName.trim(), description: newDesc.trim() || undefined });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? '');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Організації"
        onBack={() => navigation.goBack()}
        rightAction={
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('OrgSearch')}
            >
              <Ionicons name="search" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => setShowCreate(!showCreate)}
            >
              <Text style={{ color: '#fff', fontSize: 24 }}>{showCreate ? '✕' : '+'}</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {showCreate && (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.formTitle}>Нова організація</Text>
          <TextInput
            style={styles.input}
            placeholder="Назва *"
            placeholderTextColor={Colors.textMuted}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            placeholder="Опис (необов'язково)"
            placeholderTextColor={Colors.textMuted}
            value={newDesc}
            onChangeText={setNewDesc}
            multiline
          />
          <Button title="Створити" onPress={handleCreate} loading={creating} size="sm" />
        </Card>
      )}

      <FlatList
        data={orgs}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
        ListEmptyComponent={
          <EmptyState icon="🏢" title="Організацій немає" subtitle='Натисніть "+" щоб створити першу' />
        }
        renderItem={({ item: org }) => <OrgCard org={org} />}
      />
    </View>
  );
}

function OrgCard({ org }: { org: Organization }) {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [joining, setJoining] = useState(false);

  const isMember = org.members?.some((m) => m.userId === user?.id);

  return (
    <Card>
      {/* Tap header → OrgDetailScreen (FR-03b) */}
      <TouchableOpacity
        onPress={() => navigation.navigate('OrgDetail', { orgId: org.id })}
        activeOpacity={0.7}
      >
        <View style={styles.orgHeader}>
          <View style={styles.orgAvatar}>
            <Text style={{ fontSize: 22 }}>🏢</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>{org.name}</Text>
            {org.description && (
              <Text style={styles.orgDesc} numberOfLines={2}>{org.description}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>

      <View style={styles.orgStats}>
        <Text style={styles.orgStat}>👥 {org.members?.length ?? 0} учасників</Text>
        {org.children && org.children.length > 0 && (
          <Text style={styles.orgStat}>🌿 {org.children.length} підгруп</Text>
        )}
        {isMember && (
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>✓ Учасник</Text>
          </View>
        )}
      </View>

      {/* Sub-organizations */}
      {org.children && org.children.length > 0 && (
        <View style={styles.children}>
          {org.children.map((child) => (
            <TouchableOpacity
              key={child.id}
              style={styles.childRow}
              onPress={() => navigation.navigate('OrgDetail', { orgId: child.id })}
            >
              <Text style={styles.childDot}>↳</Text>
              <Text style={styles.childName}>{child.name}</Text>
              <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  formTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
    color: Colors.text, marginBottom: 12,
  },
  orgHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  orgAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  orgName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  orgDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 3 },
  orgStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  orgStat: { fontSize: 12, color: Colors.textMuted },
  memberBadge: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  memberBadgeText: { fontSize: 11, color: Colors.secondary, fontWeight: '700' },
  children: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, gap: 4 },
  childRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  childDot: { fontSize: 14, color: Colors.textMuted },
  childName: { fontSize: 13, color: Colors.textSecondary },
});
