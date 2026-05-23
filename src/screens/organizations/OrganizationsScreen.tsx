import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, StyleSheet, RefreshControl, TextInput, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { orgsApi } from '../../api/orgs.api';
import { Organization } from '../../types';
import { Colors } from '../../utils/theme';
import { Button, Card, EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { SystemRole } from '../../types';

const FILTER_TAGS = [
  '#Медицина', '#Евакуація', '#Логістика', '#Військо',
  '#Гуманітарна', '#Житло', '#Психологічна', '#Термінова',
];

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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

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

  // Мої організації (користувач є членом)
  const myOrgs = useMemo(() => {
    return orgs.filter((org) => org.members?.some((m) => m.userId === user?.id));
  }, [orgs, user?.id]);

  // Фільтрація по тегах
  const filteredOrgs = useMemo(() => {
    let result = orgs;
    if (selectedTags.length === 0) return result;
    return result.filter((org) => {
      const orgTags = org.tags || [];
      return selectedTags.some((tag) => orgTags.includes(tag));
    });
  }, [orgs, selectedTags]);

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

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
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

      {/* Мої організації (швидкий доступ) */}
      {myOrgs.length > 0 && (
        <View style={styles.myOrgsContainer}>
          <Text style={styles.myOrgsLabel}>Мої організації</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.myOrgsRow}>
              {myOrgs.map((org) => (
                <TouchableOpacity
                  key={org.id}
                  onPress={() => navigation.navigate('OrgDetail', { orgId: org.id })}
                >
                  <View style={styles.myOrgChip}>
                    <Text style={styles.myOrgEmoji}>🏢</Text>
                    <Text style={styles.myOrgName} numberOfLines={1}>{org.name}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Фільтр по тегах */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>
          {selectedTags.length > 0 ? `Фільтр (${selectedTags.length})` : 'Фільтр по тегах'}
        </Text>
        <View style={styles.filterRow}>
          {FILTER_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[styles.filterChip, isSelected && styles.filterChipSelected]}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
          {selectedTags.length > 0 && (
            <TouchableOpacity
              onPress={() => setSelectedTags([])}
              style={styles.filterClear}
            >
              <Text style={styles.filterClearText}>✕ Скинути</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={filteredOrgs}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
        ListEmptyComponent={
          <EmptyState icon="🏢" title={selectedTags.length > 0 ? 'Нічого не знайдено за цими тегами' : 'Організацій немає'} subtitle={selectedTags.length > 0 ? 'Спробуйте інші теги' : 'Натисніть "+" щоб створити першу'} />
        }
        renderItem={({ item: org }) => <OrgCard org={org} />}
      />
    </View>
  );
}

function OrgCard({ org }: { org: Organization }) {
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const isMember = org.members?.some((m) => m.userId === user?.id);

  return (
    <Card style={{ marginBottom: 12, padding: 16 }}>
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
            {/* Теги в картці */}
            {org.tags && org.tags.length > 0 && (
              <View style={styles.cardTags}>
                {org.tags.slice(0, 3).map((tag, i) => (
                  <Text key={i} style={styles.cardTag}>{tag}</Text>
                ))}
                {org.tags.length > 3 && (
                  <Text style={styles.cardTag}>+{org.tags.length - 3}</Text>
                )}
              </View>
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

      {org.children && org.children.length > 0 && (
        <View style={styles.children}>
          {org.children.map((child) => (
            <TouchableOpacity
              key={child.id}
              style={styles.childRow}
              onPress={() => navigation.push('OrgDetail', {
                orgId: child.id,
                parentPath: [{ id: org.id, name: org.name, parentOrgId: org.parentOrgId }],
              })}
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
  filterContainer: {
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  filterLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.textMuted,
    marginBottom: 6, textTransform: 'uppercase',
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  filterChipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  filterChipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  filterChipTextSelected: { color: Colors.primary },
  filterClear: { paddingHorizontal: 8, paddingVertical: 5 },
  filterClearText: { fontSize: 12, fontWeight: '600', color: Colors.danger },
  myOrgsContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  myOrgsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  myOrgsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  myOrgChip: {
    alignItems: 'center',
    width: 80,
  },
  myOrgEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  myOrgName: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
    maxWidth: 80,
  },
  orgHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  orgAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  orgName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  orgDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 3 },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  cardTag: {
    fontSize: 11, color: Colors.primary, fontWeight: '600',
    backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
  },
  orgStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  orgStat: { fontSize: 12, color: Colors.textMuted },
  memberBadge: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  memberBadgeText: { fontSize: 11, color: Colors.secondary, fontWeight: '700' },
  children: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, gap: 4 },
  childRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  childDot: { fontSize: 14, color: Colors.textMuted },
  childName: { fontSize: 13, color: Colors.textSecondary },
});