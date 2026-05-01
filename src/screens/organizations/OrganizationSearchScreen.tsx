import React, { useState, useEffect } from 'react';
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

export default function OrganizationSearchScreen() {
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

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

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query.trim().length >= 2 ? (
            <EmptyState
              icon="🔍"
              title="Нічого не знайдено"
              subtitle="Спробуйте інший запит"
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
});