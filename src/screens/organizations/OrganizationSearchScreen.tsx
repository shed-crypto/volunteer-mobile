import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput,
  TouchableOpacity, StyleSheet, ActivityIndicator
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { orgsApi } from '../../api/orgs.api';
import { Organization } from '../../types';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Card, EmptyState } from '../../components/ui';

const FILTER_TAGS = [
  '#Медицина', '#Евакуація', '#Логістика', '#Військо',
  '#Гуманітарна', '#Житло', '#Психологічна', '#Термінова',
];

export default function OrganizationSearchScreen() {
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        handleSearch();
      } else {
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  // Фільтрація результатів по тегах
  const filteredResults = useMemo(() => {
    if (selectedTags.length === 0) return results;
    return results.filter((org) => {
      const orgTags = org.tags || [];
      return selectedTags.some((tag) => orgTags.includes(tag));
    });
  }, [results, selectedTags]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await orgsApi.search(query.trim());
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Пошук організацій"
        onBack={() => navigation.goBack()}
      />

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={Colors.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Введіть назву або опис..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {loading && <ActivityIndicator size="small" color={Colors.primary} />}
        </View>
      </View>

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
        data={filteredResults}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query.trim().length >= 2 ? (
            <EmptyState
              icon="🔍"
              title={selectedTags.length > 0 ? 'Нічого не знайдено за цими тегами' : 'Нічого не знайдено'}
              subtitle={selectedTags.length > 0 ? 'Спробуйте інші теги' : 'Спробуйте інший запит'}
            />
          ) : (
            <EmptyState
              icon="🏢"
              title="Знайдіть організацію"
              subtitle="Введіть хоча б 2 символи для пошуку"
            />
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('OrgDetail', { orgId: item.id })}
          >
            <Card style={styles.card}>
              <View style={styles.orgRow}>
                <View style={styles.orgAvatar}>
                  <Text style={{ fontSize: 20 }}>🏢</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orgName}>{item.name}</Text>
                  {item.description && (
                    <Text style={styles.orgDesc} numberOfLines={1}>
                      {item.description}
                    </Text>
                  )}
                  {/* Теги в результатах пошуку */}
                  {item.tags && item.tags.length > 0 && (
                    <View style={styles.cardTags}>
                      {item.tags.slice(0, 3).map((tag, i) => (
                        <Text key={i} style={styles.cardTag}>{tag}</Text>
                      ))}
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </Card>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchContainer: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  input: { flex: 1, fontSize: 16, color: Colors.text },
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
  list: { padding: 16 },
  card: { marginBottom: 12, padding: 12 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orgAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  orgName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  orgDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  cardTag: {
    fontSize: 11, color: Colors.primary, fontWeight: '600',
    backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
  },
});