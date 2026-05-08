/**
 * RequestsListScreen.tsx
 *
 * БАГ-ФІКси:
 * 1. Заявки зникали при перезаході: catch → setRequests([]) очищував список
 *    навіть якщо вже були завантажені дані. Тепер зберігаємо старі дані при помилці.
 * 2. Волонтер не може подати заявку: додано VOLUNTEER до canCreate з поясненням.
 *    Логіка: волонтер теж може потребувати допомоги (наприклад, зламалось авто
 *    на місії). Подавши заявку він стає "requester" по суті цієї заявки.
 */
import React, { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  RefreshControl, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { requestsApi } from '../../api/requests.api';
import { Request, RequestStatus, RequestCategory, RequestUrgency } from '../../types';
import { Colors, urgencyColors, statusColors, categoryLabels } from '../../utils/theme';
import { Badge, Card, EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { SystemRole } from '../../types';
  import { collections } from '../../db/index';
  import { SyncService } from '../../db/SyncService';
  import { database } from '../../db/index';

const STATUS_FILTERS = [
  { value: 'all',                      label: 'Всі' },
  { value: 'my',                       label: 'Мої' },
  { value: RequestStatus.OPEN,         label: 'Відкриті' },
  { value: RequestStatus.IN_PROGRESS,  label: 'Виконуються' },
  { value: RequestStatus.PENDING_REVIEW, label: 'На перевірці' },
  { value: RequestStatus.COMPLETED,    label: 'Завершені' },
];

const URGENCY_FILTERS = [
  { value: RequestUrgency.CRITICAL, label: '🚨 Критична' },
  { value: RequestUrgency.HIGH,     label: '⚠️ Висока' },
  { value: RequestUrgency.MEDIUM,   label: '📋 Середня' },
  { value: RequestUrgency.LOW,      label: '📌 Низька' },
];

const CATEGORY_FILTERS = [
  { value: RequestCategory.MEDICAL,       label: '🏥 Медична' },
  { value: RequestCategory.EVACUATION,    label: '🚗 Евакуація' },
  { value: RequestCategory.LOGISTICS,     label: '📦 Логістика' },
  { value: RequestCategory.MILITARY,      label: '🪖 Військова' },
  { value: RequestCategory.HUMANITARIAN,  label: '🤝 Гуманітарна' },
  { value: RequestCategory.SHELTER,       label: '🏠 Притулок' },
  { value: RequestCategory.PSYCHOLOGICAL, label: '🧠 Психологічна' },
];

export default function RequestsListScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter]     = useState<string | undefined>('all');
  const [urgencyFilter, setUrgencyFilter]   = useState<RequestUrgency | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<RequestCategory | undefined>();
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');
  const [filteredRequests, setFilteredRequests] = useState<Request[]>([]);
  const { isOffline } = useNetwork();
  
  // Reverse geocoding state for location names
  const [locationName, setLocationName] = useState<string | null>(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingError, setGeocodingError]   = useState<string | null>(null);

  const activeFiltersCount = [urgencyFilter, categoryFilter, regionSearch].filter(Boolean).length;

  // ─── Load from local DB helper ───────────────────────────────────────────
  const loadFromLocalDB = useCallback(async (): Promise<Request[]> => {
    try {
      const localReqs = await collections.requests.query().fetch();
      if (localReqs.length === 0) return [];
      
      // Load saved request IDs to add isSaved flag
      const savedRequests = await collections.savedRequests.query().fetch();
      const savedIds = new Set(savedRequests.map((s: any) => s.requestId));
      
      const mapped = localReqs.map((r: any) => ({
        id: r.serverId || r.id,
        title: r.title,
        description: r.description ?? '',
        category: r.category,
        urgency: r.urgency,
        status: r.status,
        requiredClearance: r.requiredClearance,
        latitude: r.latitude ?? undefined,
        longitude: r.longitude ?? undefined,
        isLocationHidden: r.isLocationHidden ?? false,
        tags: r.tags ?? [],
        creatorId: r.creatorId ?? '',
        createdAt: r.createdAtServer
          ? new Date(r.createdAtServer).toISOString()
          : new Date().toISOString(),
        isSaved: savedIds.has(r.serverId || r.id),
      }));
      
      // Apply filters locally
      return mapped.filter((r: any) => {
        if (statusFilter === 'my') {
          if (r.creatorId !== user?.id) return false;
        } else if (statusFilter === 'all') {
          if (r.creatorId === user?.id) return false;
        } else if (statusFilter && r.status !== statusFilter) {
          return false;
        }
        if (urgencyFilter && r.urgency !== urgencyFilter) return false;
        if (categoryFilter && r.category !== categoryFilter) return false;
        if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }) as Request[];
    } catch (e) {
      OfflineLogger.cache('RequestsList: local DB load failed', e);
      return [];
    }
  }, [search, statusFilter, urgencyFilter, categoryFilter]);

  // ─── Helper: save server data to local DB ───────────────────────────────
  const saveRequestsToLocalDB = useCallback(async (requestsData: Request[]) => {
    try {
      OfflineLogger.cache(`RequestsList: saving ${requestsData.length} requests to DB`);
      const existing = await collections.requests.query().fetch();
      const existingMap = new Map(existing.map((r: any) => [r.serverId, r]));
      const operations: any[] = [];

      for (const req of requestsData) {
        const existingReq = existingMap.get(req.id);
        if (existingReq) {
          operations.push(
            existingReq.prepareUpdate((r: any) => {
              r.title = req.title;
              r.description = req.description ?? null;
              r.category = req.category;
              r.urgency = req.urgency;
              r.status = req.status;
              r.requiredClearance = req.requiredClearance ?? 'local';
              r.latitude = req.latitude ?? null;
              r.longitude = req.longitude ?? null;
              r.isLocationHidden = req.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(req.tags ?? []);
              r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
              r.isSynced = true;
              r.pendingAction = null;
              r.lastSyncedAt = Date.now();
            })
          );
        } else {
          operations.push(
            collections.requests.prepareCreate((r: any) => {
              r.serverId = req.id;
              r.title = req.title;
              r.description = req.description ?? null;
              r.category = req.category;
              r.urgency = req.urgency;
              r.status = req.status;
              r.requiredClearance = req.requiredClearance ?? 'local';
              r.creatorId = req.creatorId ?? null;
              r.latitude = req.latitude ?? null;
              r.longitude = req.longitude ?? null;
              r.isLocationHidden = req.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(req.tags ?? []);
              r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
              r.createdAtServer = req.createdAt ? new Date(req.createdAt).getTime() : Date.now();
              r.isSynced = true;
              r.pendingAction = null;
              r.lastSyncedAt = Date.now();
            })
          );
        }
      }

      if (operations.length > 0) {
        await database.write(async () => {
          await database.batch(...operations);
        });
        OfflineLogger.cache(`RequestsList: saved ${operations.length} operations to DB`);
      }
    } catch (e) {
      OfflineLogger.cache('RequestsList: save to DB failed', e);
    }
  }, []);

  // ─── Helper: load from local DB with ADAPTIVE timeout ────────────────────
  // ОНЛАЙН: 300мс (швидкий fallback, дані є — покажемо, немає — йдемо на сервер)
  // ОФЛАЙН: 10000мс (чекаємо доки БД буде готова)
  const loadFromLocalDBWithTimeout = useCallback(async (): Promise<Request[]> => {
    const timeout = isOffline ? 10000 : 300;
    return Promise.race([
      loadFromLocalDB(),
      new Promise<Request[]>((resolve) => setTimeout(() => {
        OfflineLogger.cache(`RequestsList: local DB timeout (${timeout}ms, ${isOffline ? 'offline' : 'online'})`);
        resolve([]);
      }, timeout))
    ]);
  }, [loadFromLocalDB, isOffline]);

  // ─── Main load: OFFLINE-FIRST ────────────────────────────────────────────
  const load = useCallback(async () => {
    setHasError(false);
    OfflineLogger.nav('RequestsListScreen.load() called');

    try {
      // КРОК 1: Load from local DB first (with ADAPTIVE timeout)
      const localData = await loadFromLocalDBWithTimeout();
      if (localData.length > 0) {
        OfflineLogger.nav('RequestsList: showing local data first');
        setRequests(localData);
      }

      // КРОК 2: If online, update from server AND save to DB
          if (!isOffline) {
            try {
              let latitude, longitude;
              try {
                const loc = await Location.getLastKnownPositionAsync({});
                if (loc) {
                  latitude = loc.coords.latitude;
                  longitude = loc.coords.longitude;
                }
              } catch {}

              const params: any = {
                limit: 50,
                latitude,
                longitude,
              };
              if (search) params.search = search;
              if (statusFilter && statusFilter !== 'all' && statusFilter !== 'my') params.status = statusFilter;
              if (urgencyFilter) params.urgency = urgencyFilter;
              if (categoryFilter) params.category = categoryFilter;

              const data = await requestsApi.getAll(params);
              setRequests(data);
          OfflineLogger.nav(`RequestsList: loaded ${data.length} from server`);
          
          // ЗБЕРЕГТИ в БД для офлайн-роботи
          await saveRequestsToLocalDB(data);
        } catch (error) {
          OfflineLogger.network('RequestsList: server load failed, keeping local data');
          setHasError(true);
          // Local data already shown, no need to clear
        }
      } else {
        OfflineLogger.nav('RequestsList: offline — showing cached data');
      }
    } catch (e) {
      OfflineLogger.nav('RequestsList: unexpected error', e);
      setHasError(true);
    } finally {
      // КРИТИЧНО: завжди знімати loading, навіть якщо БД зависла
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, urgencyFilter, categoryFilter, isOffline, loadFromLocalDBWithTimeout, saveRequestsToLocalDB]);

  useEffect(() => { load(); }, [load]);

  // Effect to update filteredRequests when filters change (except regionSearch)
  useEffect(() => {
    if (regionSearch.trim()) return; // region search overrides
    let filtered = requests;
    // Apply status filter
    if (statusFilter === 'my') {
      filtered = filtered.filter(r => r.creatorId === user?.id);
    } else if (statusFilter && statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }
    // Apply urgency filter
    if (urgencyFilter) {
      filtered = filtered.filter(r => r.urgency === urgencyFilter);
    }
    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter(r => r.category === categoryFilter);
    }
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(r => r.title.toLowerCase().includes(searchLower));
    }
    setFilteredRequests(filtered);
  }, [requests, statusFilter, urgencyFilter, categoryFilter, search, regionSearch]);

  useEffect(() => {
    const applyRegionFilter = async () => {
      if (!regionSearch.trim()) {
        setFilteredRequests(requests);
        return;
      }
      setGeocodingLoading(true);
      try {
        const geocodedRegions = await Location.geocodeAsync(regionSearch);
        if (geocodedRegions.length > 0) {
          const { latitude, longitude } = geocodedRegions[0];
          const filtered = requests.filter(req => {
            if (req.latitude && req.longitude) {
              const distance = Math.sqrt(
                Math.pow(req.latitude - latitude, 2) +
                Math.pow(req.longitude - longitude, 2)
              );
              // Simple distance check (e.g., within 0.5 degrees lat/lon)
              return distance < 0.5; 
            }
            return false;
          });
          setFilteredRequests(filtered);
        } else {
          setFilteredRequests([]);
        }
      } catch (error) {
        console.error('Region geocoding error:', error);
        setFilteredRequests([]);
      } finally {
        setGeocodingLoading(false);
      }
    };
    applyRegionFilter();
  }, [requests, regionSearch]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const clearFilters = () => {
    setUrgencyFilter(undefined);
    setCategoryFilter(undefined);
    setRegionSearch('');
  };

  // Функція отримання назви місцезнаходження за координатами (reverse geocoding)
  const fetchLocationName = useCallback(async (latitude: number, longitude: number) => {
    setGeocodingLoading(true);
    setGeocodingError(null);
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (addresses.length > 0) {
        const address = addresses[0];
        // Формуємо читабельную назву з доступних компонентів
        let parts = [];
        if (address.name) parts.push(address.name);
        if (address.street) parts.push(address.street);
        if (address.city) parts.push(address.city);
        if (address.region) parts.push(address.region);
        if (address.postalCode) parts.push(address.postalCode);
        if (address.country) parts.push(address.country);
        
        const formattedName = parts.filter(Boolean).join(', ');
        setLocationName(formattedName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      } else {
        setLocationName(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      setGeocodingError('Не вдалося визначити місце');
      setLocationName(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
    } finally {
      setGeocodingLoading(false);
    }
  }, []);

  if (loading && requests.length === 0) return <LoadingScreen />;

  // БАГ-ФІКс питання 6: VOLUNTEER теж може подавати заявки.
  // Обґрунтування: волонтер може потребувати допомоги (зламалось авто,
  // потрібна медична допомога під час місії тощо). Відмінність від REQUESTER
  // в тому, що REQUESTER — це роль для цивільних людей без волонтерського
  // досвіду. Але обмежувати волонтерів у поданні заявок нелогічно.
  const canCreate = [
    SystemRole.REQUESTER,
    SystemRole.ADMIN,
    SystemRole.COORDINATOR,
    SystemRole.VOLUNTEER, // ← додано
  ].includes(user?.systemRole as SystemRole);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Заявки на допомогу"
        subtitle={`${requests.length} заявок${hasError ? ' (офлайн)' : ''}`}
        rightAction={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate('SavedRequests' as never)}
              style={styles.addBtn}
            >
              <Text style={{ color: '#fff', fontSize: 20 }}>⭐</Text>
            </TouchableOpacity>
            {canCreate && (
              <TouchableOpacity
                onPress={() => navigation.navigate('CreateRequest')}
                style={styles.addBtn}
              >
                <Text style={{ color: '#fff', fontSize: 26, lineHeight: 28 }}>+</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* Банер помилки (не очищуємо список!) */}
      {hasError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠️ Офлайн — показано кешовані дані</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retryText}>Оновити</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search + Filter row */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍  Пошук за назвою..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          onSubmitEditing={load}
        />
        <TouchableOpacity
          style={[styles.filterBtn, activeFiltersCount > 0 && styles.filterBtnActive]}
          onPress={() => setShowFilterModal(true)}
        >
          <Text style={[styles.filterBtnText, activeFiltersCount > 0 && styles.filterBtnTextActive]}>
            {activeFiltersCount > 0 ? `Фільтри (${activeFiltersCount})` : '⚙ Фільтри'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ maxHeight: 44, flexGrow: 0 }}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map((f) => {
          const count = f.value === 'all' 
            ? requests.length 
            : f.value === 'my'
              ? requests.filter(r => r.creatorId === user?.id).length
              : requests.filter(r => r.status === f.value).length;
          
          return (
            <TouchableOpacity
              key={f.label}
              onPress={() => setStatusFilter(f.value as any)}
              style={[styles.pill, statusFilter === f.value && styles.pillActive]}
            >
              <Text style={[styles.pillText, statusFilter === f.value && styles.pillTextActive]}>
                {f.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
        {activeFiltersCount > 0 && (
          <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕ Скинути</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <FlatList
        data={filteredRequests}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        ListEmptyComponent={
          <EmptyState icon="📋" title="Заявок не знайдено" subtitle={hasError ? 'Немає мережі. Спробуйте оновити.' : 'Спробуйте змінити фільтри'} />
        }
        renderItem={({ item }) => (
          <RequestCard request={item} onPress={() => navigation.navigate('RequestDetail', { requestId: item.id })} initialSaved={(item as any).isSaved} />
        )}
      />

      {/* Filter modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Фільтри</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={styles.filterGroupLabel}>Терміновість</Text>
              <View style={styles.filterChips}>
                {URGENCY_FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    onPress={() => setUrgencyFilter(urgencyFilter === f.value ? undefined : f.value)}
                    style={[styles.chip, urgencyFilter === f.value && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, urgencyFilter === f.value && styles.chipTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.filterGroupLabel}>Категорія</Text>
              <View style={styles.filterChips}>
                {CATEGORY_FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    onPress={() => setCategoryFilter(categoryFilter === f.value ? undefined : f.value)}
                    style={[styles.chip, categoryFilter === f.value && styles.chipCategoryActive]}
                  >
                    <Text style={[styles.chipText, categoryFilter === f.value && styles.chipCategoryTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Region Search Input in Modal */}
              <Text style={styles.filterGroupLabel}>Пошук за регіоном</Text>
              <View style={styles.filterChips}>
                <TextInput
                  style={styles.regionSearchInput}
                  placeholder="Введіть регіон..."
                  placeholderTextColor={Colors.textMuted}
                  value={regionSearch}
                  onChangeText={setRegionSearch}
                  returnKeyType="search"
                  onSubmitEditing={() => setShowFilterModal(false)}
                />
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.clearAllBtn} onPress={() => { clearFilters(); setShowFilterModal(false); }}>
                <Text style={styles.clearAllBtnText}>Скинути всі</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => setShowFilterModal(false)}>
                <Text style={styles.applyBtnText}>Застосувати</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function RequestCard({ request, onPress, initialSaved }: { request: Request; onPress: () => void; initialSaved?: boolean }) {
  const { user } = useAuth();
  const isMy = request.creatorId === user?.id;
  const urgency = urgencyColors[request.urgency];
  const status  = statusColors[request.status];
  
  // Saved / bookmark state
  const [isSaved, setIsSaved] = useState(initialSaved ?? (request as any).isSaved ?? false);
  const [saving, setSaving] = useState(false);
  
  // Location state for this specific request card
  const [requestLocationName, setRequestLocationName] = useState<string | null>(null);
  const [requestGeocodingLoading, setRequestGeocodingLoading] = useState(false);
  const [requestGeocodingError, setRequestGeocodingError]   = useState<string | null>(null);

  // Update isSaved when props change (e.g., when server data arrives)
  useEffect(() => {
    const saved = initialSaved ?? (request as any).isSaved ?? false;
    if (saved !== isSaved) {
      setIsSaved(saved);
    }
  }, [initialSaved, (request as any).isSaved]);
  
  // Handle save / unsave
  const handleToggleSave = async (e: any) => {
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    try {
      if (isSaved) {
        await requestsApi.unsave(request.id);
        setIsSaved(false);
        // Remove from local DB quietly
        try {
          const localSaved = await collections.savedRequests.query().fetch();
          const item = localSaved.find((s: any) => s.requestId === request.id);
          if (item) await database.write(() => item.destroyPermanently());
        } catch (localErr) {
          OfflineLogger.cache('RequestCard: failed to remove local bookmark', localErr);
        }
      } else {
        await requestsApi.save(request.id);
        setIsSaved(true);
        // Add to local DB quietly
        try {
          await database.write(() =>
            collections.savedRequests.create((s: any) => {
              s.requestId = request.id;
              s.userId = user?.id || '';
              s.savedAt = Date.now();
            })
          );
        } catch (localErr) {
          OfflineLogger.cache('RequestCard: failed to insert local bookmark', localErr);
        }
      }
    } catch (err) {
      OfflineLogger.network('RequestCard: save toggle failed', err);
    } finally {
      setSaving(false);
    }
  };

  // Fetch location name when request coordinates change
  useEffect(() => {
    // Only attempt geocoding if we have valid numeric coordinates
    const lat = request.latitude;
    const lng = request.longitude;
    if (lat !== undefined && 
        lng !== undefined && 
        typeof lat === 'number' && 
        typeof lng === 'number') {
      const fetchName = async () => {
        setRequestGeocodingLoading(true);
        setRequestGeocodingError(null);
        try {
          const addresses = await Location.reverseGeocodeAsync({ 
            latitude: lat, 
            longitude: lng 
          });
          if (addresses.length > 0) {
            const address = addresses[0];
            let parts = [];
            // Prioritize city, then region, then street/name if not hidden
            if (address.city) parts.push(address.city);
            if (address.region && address.region !== address.city) parts.push(address.region); // Avoid duplication
            if (!request.isLocationHidden && address.street) parts.push(address.street);
            if (!request.isLocationHidden && address.name && address.name !== address.street && address.name !== address.city) parts.push(address.name); // Avoid duplication
            
            const formattedName = parts.filter(Boolean).join(', ');
            setRequestLocationName(formattedName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          } else {
            setRequestLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          }
        } catch (error) {
          console.error('Reverse geocoding error:', error);
          setRequestGeocodingError('Не вдалося визначити місце');
          setRequestLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        } finally {
          setRequestGeocodingLoading(false);
        }
      };
      
      fetchName();
    } else {
      setRequestLocationName(null);
    }
  }, [request.latitude, request.longitude, request.isLocationHidden]);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        <View style={[styles.urgencyStrip, { backgroundColor: urgency?.bg ?? Colors.borderLight }]} />
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>{request.title}</Text>
              {isMy && (
                <View style={{ backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.primary }}>👤 МОЯ</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardCategory}>{categoryLabels[request.category] ?? request.category}</Text>
          </View>
          <View style={{ gap: 4, alignItems: 'flex-end' }}>
            <TouchableOpacity onPress={handleToggleSave} style={{ padding: 4 }}>
              <Text style={{ fontSize: 20, opacity: saving ? 0.5 : 1 }}>
                {isSaved ? '⭐' : '☆'}
              </Text>
            </TouchableOpacity>
            <Badge label={urgency?.label ?? request.urgency} colorScheme="urgency" value={request.urgency} size="sm" />
            <Badge label={status?.label ?? request.status}   colorScheme="status"  value={request.status}  size="sm" />
          </View>
        </View>
        {request.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>{request.description}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          {request.latitude && request.longitude
            ? (
              <>
                {requestGeocodingLoading ? (
                  <Text style={styles.metaText}>📍 Визначаємо місце...</Text>
                ) : requestGeocodingError ? (
                  <Text style={styles.metaText}>📍 {requestGeocodingError}</Text>
                ) : requestLocationName ? (
                  <Text style={styles.metaText}>📍 {requestLocationName}{request.isLocationHidden ? ' (приблизно)' : ''}</Text>
                ) : (request.latitude && request.longitude) ? ( // Fallback to coordinates if name is not available but coordinates exist
                  <Text style={styles.metaText}>📍 {Number(request.latitude).toFixed(3)}, {Number(request.longitude).toFixed(3)}{request.isLocationHidden ? ' (приблизно)' : ''}</Text>
                ) : (
                  <Text style={styles.metaText}>📍 Місце не вказано</Text>
                )}
              </>
            )
            : <Text style={styles.metaText}>📍 Місце не вказано</Text>}
          <Text style={styles.metaText}>🗂 {request.tasks?.length ?? 0} підзадач</Text>
          {request.deadline && (
            <Text style={[styles.metaText, { color: Colors.warning }]}>
              ⏰ {new Date(request.deadline).toLocaleDateString('uk-UA')}
            </Text>
          )}
        </View>
        {request.tags?.filter(Boolean).length > 0 && (
          <View style={styles.tagRow}>
            {request.tags.filter(Boolean).slice(0, 4).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF8E1', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#FFE082',
  },
  errorText: { fontSize: 13, color: '#F57F17' },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  searchRow: {
    flexDirection: 'row', gap: 8, padding: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.border,
  },
  filterBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  filterBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  filterBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  filterBtnTextActive: { color: Colors.primary },
  filterRow: {
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    flexDirection: 'row', alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
    flexShrink: 0,
    minWidth: 80,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight, flexShrink: 0, minWidth: 80, minHeight: 36 },
  pillText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  pillTextActive: { color: Colors.primary, textAlign: 'center' },
  clearBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: Colors.dangerLight, borderWidth: 1.5, borderColor: Colors.danger,
  },
  clearBtnText: { fontSize: 12, fontWeight: '600', color: Colors.danger },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%', paddingTop: 8,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  modalClose: { fontSize: 20, color: Colors.textMuted, padding: 4 },
  filterGroupLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.textSecondary,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.primary },
  chipCategoryActive: { borderColor: Colors.secondary, backgroundColor: Colors.secondaryLight },
  chipCategoryTextActive: { color: Colors.secondary },
  modalActions: {
    flexDirection: 'row', gap: 12, padding: 16,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  clearAllBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  clearAllBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  applyBtn: { flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center' },
  applyBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  urgencyStrip: { height: 4, borderRadius: 2, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, lineHeight: 20 },
  cardCategory: { fontSize: 12, color: Colors.textSecondary },
  cardDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  metaText: { fontSize: 12, color: Colors.textMuted },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  regionSearchInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
