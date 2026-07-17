/**
 * RequestsListScreen.tsx
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  RefreshControl, StyleSheet, Modal, ScrollView, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { requestsApi } from '../../api/requests.api';
import { Request, RequestStatus, RequestCategory, RequestUrgency } from '../../types';
import { Colors, urgencyColors, statusColors, categoryLabels } from '../../utils/theme';
import { Badge, Card, EmptyState, LoadingScreen, ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { SystemRole } from '../../types';
import api, { getServerReachable } from '../../api/axios';
import { SyncService } from '../../db/SyncService';
import { checkServerReachable } from '../../api/axios';
import { collections, database, safeWrite } from '../../db/index';
import SosModal from '../../components/SosModal';
import { locationHelper } from '../../utils/locationHelper';
import { usersApi } from '../../api/users.api';
import { calculateDistance, formatDistance } from '../../utils/distance';

const STATUS_FILTERS = [
  { value: 'all',                      label: 'Всі' },
  { value: 'active',                   label: 'Активні' },
  { value: 'my',                       label: 'Мої' },
  { value: 'my_tasks',                 label: 'Я виконую' },
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
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [hideDoneCancelled, setHideDoneCancelled] = useState(true);
  const { isOffline } = useNetwork();
  const isLoadingRef = useRef(false);
  
  // Pagination state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;
  const serverDataReceivedRef = useRef(false);
  
  // Reverse geocoding state for location names
  const [locationName, setLocationName] = useState<string | null>(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingError, setGeocodingError]   = useState<string | null>(null);

  // SOS state
  const [showSosModal, setShowSosModal] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  // User location for distance calculation
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);

  useEffect(() => {
    // Тихо отримуємо локацію без показу попередження (showErrorAlert = false)
    locationHelper.getCurrentLocation(false).then(loc => {
      if (loc) setUserLocation(loc);
    });
  }, []);

  const activeFiltersCount = [urgencyFilter, categoryFilter, regionSearch].filter(Boolean).length;

  // ─── Load from local DB helper ───────────────────────────────────────────
  const loadFromLocalDB = useCallback(async (): Promise<Request[]> => {
    try {
      const localReqs = await collections.requests.query().fetch();
      if (localReqs.length === 0) return [];

      // Load saved request IDs to add isSaved flag
      const savedRequests = await collections.savedRequests.query().fetch();
      const savedIds = new Set(savedRequests.map((s: any) => s.requestId));

      // Завантажуємо всі локальні задачі для підрахунку taskCount
      const allLocalTasks = await collections.tasks.query().fetch();
      const taskCountByRequest = new Map<string, number>();
      // Завантажуємо призначення для offline isUserAssigned
      const allLocalAssignments = await collections.taskAssignments.query().fetch();
      // Завантажуємо членства в організаціях для offline isMyOrgDelegating
      const allLocalMembers = await collections.organizationMembers.query().fetch();
      const userOrgIds = new Set(
        allLocalMembers
          .filter((m: any) => m.userId === user?.id && m.isActive !== false)
          .map((m: any) => m.organizationId)
      );

      // Build a map: taskId -> requestId
      const taskToRequestMap = new Map<string, string>();
      for (const t of allLocalTasks) {
        const reqId = (t as any).requestServerId || (t as any).requestId;
        const taskId = (t as any).serverId || t.id;
        if (reqId && taskId) taskToRequestMap.set(taskId, reqId);
        if (reqId) taskCountByRequest.set(reqId, (taskCountByRequest.get(reqId) || 0) + 1);
      }

      // Build a set of requestIds where user has active assignments
      const assignedRequestIds = new Set<string>();
      for (const a of allLocalAssignments) {
        const taskId = (a as any).taskId;
        const reqId = taskToRequestMap.get(taskId);
        const status = (a as any).status;
        if (reqId && (a as any).userId === user?.id && status !== 'withdrawn' && status !== 'completed') {
          assignedRequestIds.add(reqId);
        }
      }

      const mapped = localReqs.map((r: any) => {
        const serverId = r.serverId || '';
        // Якщо taskCount збережено в БД — використовуємо його, інакше рахуємо локально
        const savedCount = r.taskCount ?? 0;
        const localCount = taskCountByRequest.get(serverId) || 0;
        const effectiveCount = savedCount > 0 ? savedCount : localCount;

        // Compute isUserAssigned from local data
        const isUserAssigned = assignedRequestIds.has(serverId);
        // Compute isMyOrgDelegating: check if managing org is one of user's orgs
        const managingOrgId = (r as any).managingOrganizationId;
        const isMyOrgDelegating = managingOrgId ? userOrgIds.has(managingOrgId) : false;

        return {
          id: serverId,
          localId: r.id,
          serverId: r.serverId || undefined,
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
          additionalInfo: r.additionalInfo ?? [],
          mediaUrls: r.mediaUrls ?? [],
          reportUrls: r.reportUrls ?? [],
          managingOrganizationId: r.managingOrganizationId ?? undefined,
          cancelledByUserId: r.cancelledByUserId ?? undefined,
          cancelledAt: r.cancelledAt ? new Date(r.cancelledAt).toISOString() : undefined,
          cancelReason: r.cancelReason ?? undefined,
          taskCount: effectiveCount,
          creatorId: r.creatorId ?? '',
          createdAt: r.createdAtServer
            ? new Date(r.createdAtServer).toISOString()
            : new Date().toISOString(),
          updatedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : new Date().toISOString(),
          isSaved: savedIds.has(r.serverId || r.id),
          isUserAssigned,
          isMyOrgDelegating,
          delegatedOrgNames: isMyOrgDelegating ? (userOrgIds.size > 0 ? ['Ваша організація'] : []) : [],
          myDelegatedOrgNames: isMyOrgDelegating ? (userOrgIds.size > 0 ? ['Ваша організація'] : []) : [],
        };
      });

      return mapped as Request[];
    } catch (e) {
      OfflineLogger.cache('RequestsList: local DB load failed', e);
      return [];
    }
  }, [user?.id]);

  // ─── Helper: save server data to local DB ───────────────────────────────
  const saveRequestsToLocalDB = useCallback(async (requestsData: Request[]) => {
    try {
      OfflineLogger.cache(`RequestsList: saving ${requestsData.length} requests to DB`);
      const existing = await collections.requests.query().fetch();
      const existingMap = new Map(existing.map((r: any) => [r.serverId, r]));
      const operations: any[] = [];

      const newServerIds = new Set(requestsData.map(r => r.id));

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
              r.creatorId = req.creatorId ?? null;
              r.managingOrganizationId = (req as any).managingOrganizationId ?? null;
              r.cancelledByUserId = (req as any).cancelledByUserId ?? null;
              r.cancelledAt = (req as any).cancelledAt ? new Date((req as any).cancelledAt).getTime() : null;
              r.cancelReason = (req as any).cancelReason ?? null;
              r.latitude = req.latitude ?? null;
              r.longitude = req.longitude ?? null;
              r.isLocationHidden = req.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(req.tags ?? []);
              r.additionalInfoRaw = JSON.stringify(req.additionalInfo ?? []);
              r.mediaUrlsRaw = JSON.stringify(req.mediaUrls ?? []);
              r.reportUrlsRaw = JSON.stringify(req.reportUrls ?? []);
              r.taskCount = req.taskCount ?? 0;
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
              r.managingOrganizationId = (req as any).managingOrganizationId ?? null;
              r.cancelledByUserId = (req as any).cancelledByUserId ?? null;
              r.cancelledAt = (req as any).cancelledAt ? new Date((req as any).cancelledAt).getTime() : null;
              r.cancelReason = (req as any).cancelReason ?? null;
              r.latitude = req.latitude ?? null;
              r.longitude = req.longitude ?? null;
              r.isLocationHidden = req.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(req.tags ?? []);
              r.additionalInfoRaw = JSON.stringify(req.additionalInfo ?? []);
              r.mediaUrlsRaw = JSON.stringify(req.mediaUrls ?? []);
              r.reportUrlsRaw = JSON.stringify(req.reportUrls ?? []);
              r.taskCount = req.taskCount ?? 0;
              r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
              r.createdAtServer = req.createdAt ? new Date(req.createdAt).getTime() : Date.now();
              r.isSynced = true;
              r.pendingAction = null;
              r.lastSyncedAt = Date.now();
            })
          );
        }
      }

      // DO NOT clean up stale records — it causes data loss when server ID format differs from local
      // Offline-created records that haven't been synced will have a local ID that doesn't match
      // any server ID. Deleting them would remove user's work.
      // We only delete records that have NO serverId AND NO pendingAction AND are not in server set
      // (truly orphaned records)
      const staleRecords = existing.filter((r: any) => {
        // Never delete records with pendingAction (offline-created)
        if (r.pendingAction) return false;
        // Never delete records that have no serverId (fully local)
        if (!r.serverId) return false;
        // Never delete records that are in the server response
        if (newServerIds.has(r.serverId)) return false;
        // Only delete if ALL conditions met: has serverId, no pending action, not in server response
        // AND the serverId looks like a request UUID (not a user ID that leaked into the field)
        // For now, we NEVER delete — safer to keep stale data than lose user's records
        OfflineLogger.cache(`RequestsList: NOT deleting stale record serverId="${r.serverId}" — preserving local data`);
        return false;
      });

      // stale removal is DISABLED to prevent data loss
      // for (const stale of staleRecords) {
      //   operations.push(stale.prepareDestroyPermanently());
      // }

      if (operations.length > 0) {
        await safeWrite(async () => {
          await database.batch(...operations);
        });
        OfflineLogger.cache(`RequestsList: saved ${operations.length} operations to DB`);
      }
    } catch (e: any) {
      if (e?.name === 'Diagnostic error' || String(e?.message || '').includes('Diagnostic')) {
        OfflineLogger.cache('RequestsList: save skipped (sync already wrote it)');
      } else {
        OfflineLogger.cache('RequestsList: save to DB failed', e);
      }
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
    if (isLoadingRef.current) {
      OfflineLogger.nav('RequestsListScreen.load() skipped — already loading');
      return;
    }
    isLoadingRef.current = true;
    setHasError(false);
    OfflineLogger.nav('RequestsListScreen.load() called');

    try {
      // ── CLEANUP: remove local records with junk serverIds (user IDs leaked into the field) ──
      try {
        const allLocal = await collections.requests.query().fetch();
        const currentUserId = user?.id || '';
        const junkRecords = allLocal.filter((r: any) => {
          // Records where serverId equals the current user's ID are junk
          if (r.serverId && r.serverId === currentUserId) return true;
          return false;
        });
        if (junkRecords.length > 0) {
          OfflineLogger.cache(`RequestsList: removing ${junkRecords.length} junk records with user ID as serverId`);
          await safeWrite(async () => {
            for (const junk of junkRecords) {
              await junk.destroyPermanently();
            }
          });
        }
      } catch (cleanupError) {
        OfflineLogger.cache('RequestsList: cleanup failed (non-fatal)', cleanupError);
      }

      // Load from local DB first (with ADAPTIVE timeout)
      const localData = await loadFromLocalDBWithTimeout();
      if (localData.length > 0 && !serverDataReceivedRef.current) {
        OfflineLogger.nav('RequestsList: showing local data first');
        setRequests(localData);
      }

       // If online, update from server AND save to DB
           if (!isOffline) {
             try {
               // DO NOT pass coordinates here — geo-sorting is only for map view.
               // Passing lat/lng without radiusKm triggers unnecessary PostGIS raw SQL
               // on the server and causes 500 errors.

      const params: any = {
        limit: PAGE_SIZE,
        offset: 0,
      };
               if (search) params.search = search;
               if (statusFilter === 'my') params.creatorId = user?.id;
               else if (statusFilter && statusFilter !== 'all' && statusFilter !== 'my_tasks' && statusFilter !== 'active') params.status = statusFilter;
              if (urgencyFilter) params.urgency = urgencyFilter;
              if (categoryFilter) params.category = categoryFilter;

              const data = await requestsApi.getAll(params);
              serverDataReceivedRef.current = true;
              setRequests(data);
          OfflineLogger.nav(`RequestsList: loaded ${data.length} from server`);
          
          // ЗБЕРЕГТИ в БД для офлайн-роботи
            await saveRequestsToLocalDB(data);
            setOffset(0);
            setHasMore(data.length === PAGE_SIZE);
        } catch (error) {
          OfflineLogger.network('RequestsList: server load failed, keeping local data');
          setHasError(true);
          // Local data already shown, no need to clear
        }
      } else {
        OfflineLogger.nav('RequestsList: offline — showing cached data');
        serverDataReceivedRef.current = false;
      }
    } catch (e) {
      OfflineLogger.nav('RequestsList: unexpected error', e);
      setHasError(true);
    } finally {
      // Always clear loading state to prevent infinite loading
      isLoadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, urgencyFilter, categoryFilter, isOffline, loadFromLocalDBWithTimeout, saveRequestsToLocalDB, user]);

  // ─── Load more (pagination) ─────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (isOffline || !hasMore || loadingMore || isLoadingRef.current) return;
    setLoadingMore(true);
    try {
      // DO NOT pass coordinates in list views — geo-sorting is map-only.
      // Passing lat/lng without radiusKm triggers unnecessary PostGIS raw SQL
      const nextOffset = offset + PAGE_SIZE;
      const params: any = {
        limit: PAGE_SIZE,
        offset: nextOffset,
      };
      if (search) params.search = search;
      if (statusFilter === 'my') params.creatorId = user?.id;
      else if (statusFilter && statusFilter !== 'all' && statusFilter !== 'my_tasks' && statusFilter !== 'active') params.status = statusFilter;
      if (urgencyFilter) params.urgency = urgencyFilter;
      if (categoryFilter) params.category = categoryFilter;

      const data = await requestsApi.getAll(params);
      if (data.length > 0) {
        setRequests(prev => [...prev, ...data]);
        setOffset(nextOffset);
      }
      setHasMore(data.length === PAGE_SIZE);
      await saveRequestsToLocalDB(data);
    } catch (error) {
      OfflineLogger.network('RequestsList: loadMore failed', error);
    } finally {
      setLoadingMore(false);
    }
  }, [isOffline, hasMore, loadingMore, offset, search, statusFilter, urgencyFilter, categoryFilter, saveRequestsToLocalDB, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Apply all filters when requests or any filter changes
  useEffect(() => {
    let filtered = requests;

    // Apply status filter
    if (statusFilter === 'my') {
      filtered = filtered.filter(r => r.creatorId === user?.id);
    } else if (statusFilter === 'my_tasks') {
      // "Я виконую" — filter by isUserAssigned flag (already computed from server or local DB)
      filtered = filtered.filter(r => (r as any).isUserAssigned === true);
    } else if (statusFilter && statusFilter !== 'all' && statusFilter !== 'active') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    // "Активні" — hide completed and cancelled
    if (statusFilter === 'active' || ((statusFilter === 'all' || !statusFilter) && hideDoneCancelled)) {
      filtered = filtered.filter(r => r.status !== RequestStatus.COMPLETED && r.status !== RequestStatus.CANCELLED);
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

    // Deduplicate by ID to avoid React duplicate keys
    const seen = new Set<string>();
    filtered = filtered.filter(r => {
      const key = r.id || (r as any).serverId || (r as any).localId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Normalize tags to prevent "tags.filter is not a function" crash
    filtered = (filtered as Request[]).map(r => ({
      ...r,
      tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === 'string' ? (r.tags as string).split(',').filter(Boolean) : []),
      additionalInfo: Array.isArray(r.additionalInfo) ? r.additionalInfo : [],
      mediaUrls: Array.isArray(r.mediaUrls) ? r.mediaUrls : [],
      reportUrls: Array.isArray(r.reportUrls) ? r.reportUrls : [],
    }));

    // Apply region filter (async — only if regionSearch is not empty)
    if (regionSearch.trim()) {
      setGeocodingLoading(true);
      Location.geocodeAsync(regionSearch)
        .then((geocodedRegions) => {
          if (geocodedRegions.length > 0) {
            const { latitude, longitude } = geocodedRegions[0];
            const regionFiltered = filtered.filter(req => {
              if (req.latitude && req.longitude) {
                const distance = Math.sqrt(
                  Math.pow(req.latitude - latitude, 2) +
                  Math.pow(req.longitude - longitude, 2)
                );
                return distance < 0.5;
              }
              return false;
            });
            setFilteredRequests(regionFiltered);
          } else {
            setFilteredRequests([]);
          }
        })
        .catch((error) => {
          console.error('Region geocoding error:', error);
          setFilteredRequests([]);
        })
        .finally(() => setGeocodingLoading(false));
    } else {
      setFilteredRequests(filtered);
    }
  }, [requests, statusFilter, urgencyFilter, categoryFilter, search, regionSearch, hideDoneCancelled, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    setServerUnreachable(false);
    
    // Explicit health-check with 3s timeout (not relying on cache)
    const serverReachable = await checkServerReachable();
    
    if (serverReachable) {
      OfflineLogger.nav('Refresh: server reachable — force sync');
    } else {
      OfflineLogger.nav('Refresh: server NOT reachable — cached data only');
      setServerUnreachable(true);
    }
    
    await load();
  };

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

  // ─── SOS та Чекін ────────────────────────────────────────────────────────
  const handleStandardSos = async () => {
    setShowSosModal(false);
    try {
      const loc = await locationHelper.getCurrentLocation(true);
      if (!loc) return; // User denied or error
      const sosData = {
        title: 'SOS Допомога!',
        description: 'Автоматичний SOS виклик від волонтера.',
        category: RequestCategory.MEDICAL,
        urgency: RequestUrgency.CRITICAL,
        tags: ['#SOS'],
        latitude: loc.latitude,
        longitude: loc.longitude,
        isLocationHidden: true,
      };
      await requestsApi.create(sosData as any);
      Alert.alert('SOS відправлено', 'Ваш сигнал успішно надіслано в систему.');
      load();
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Не вдалося створити SOS заявку');
    }
  };

  const handleEditedSos = () => {
    setShowSosModal(false);
    navigation.navigate('CreateRequest', { isSos: true });
  };

  const handleCheckIn = async () => {
    try {
      const loc = await locationHelper.getCurrentLocation(true);
      if (!loc) return;
      await usersApi.checkin(loc.latitude, loc.longitude);
      setCheckedIn(true);
      Alert.alert('✅ Чекін успішний', 'Ваша безпека підтверджена, поточну локацію оновлено.');
      // Через 60 секунд знову показати кнопку
      setTimeout(() => setCheckedIn(false), 60000);
    } catch (e) {
      console.error('Checkin error:', e);
      Alert.alert('Помилка', 'Не вдалося виконати чекін');
    }
  };

  if (loading && requests.length === 0) return <LoadingScreen />;

  const canCreate = [
    SystemRole.REQUESTER,
    SystemRole.ADMIN,
    SystemRole.COORDINATOR,
    SystemRole.VOLUNTEER,
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

      {/* Банер недоступності сервера при pull-to-refresh */}
      {serverUnreachable && (
        <View style={[styles.errorBanner, { backgroundColor: '#FFF3E0', borderBottomColor: '#FFB74D' }]}>
          <Text style={[styles.errorText, { color: '#E65100' }]}>📴 Сервер недоступний — показано кешовані дані</Text>
          <TouchableOpacity onPress={() => setServerUnreachable(false)}>
            <Text style={styles.retryText}>Закрити</Text>
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

      {/* Status pills — only show when data + user are ready */}
      {!loading && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ maxHeight: 44, flexGrow: 0 }}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.label}
            onPress={() => setStatusFilter(f.value as any)}
            style={[styles.pill, statusFilter === f.value && styles.pillActive]}
          >
            <Text style={[styles.pillText, statusFilter === f.value && styles.pillTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        {activeFiltersCount > 0 && (
          <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕ Скинути</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      )}

      <FlatList
        data={filteredRequests}
        keyExtractor={(r: any) => r.serverId || r.localId || r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ color: Colors.textMuted, fontSize: 12 }}>Завантаження...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState icon="📋" title="Заявок не знайдено" subtitle={hasError ? 'Немає мережі. Спробуйте оновити.' : 'Спробуйте змінити фільтри'} />
        }
        renderItem={({ item }) => (
          <RequestCard
            request={item}
            onPress={() => navigation.navigate('RequestDetail', {
              requestId: (item as any).serverId || item.id,
              localId: (item as any).localId,
              serverId: (item as any).serverId || item.id,
            })}
            initialSaved={(item as any).isSaved}
            userLocation={userLocation}
          />
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

              {/* Hide completed/cancelled toggle */}
              <Text style={styles.filterGroupLabel}>Відображення</Text>
              <View style={[styles.filterChips, { alignItems: 'center' }]}>
                <TouchableOpacity
                  onPress={() => setHideDoneCancelled(prev => !prev)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <View style={[
                    { width: 44, height: 24, borderRadius: 12, backgroundColor: hideDoneCancelled ? Colors.primary : Colors.border },
                    { justifyContent: 'center', paddingHorizontal: 2 }
                  ]}>
                    <View style={{
                      width: 20, height: 20, borderRadius: 10,
                      backgroundColor: '#fff',
                      transform: [{ translateX: hideDoneCancelled ? 20 : 0 }],
                    }} />
                  </View>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '600' }}>
                    Приховати завершені та скасовані
                  </Text>
                </TouchableOpacity>
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

      {/* Floating Action Buttons — в різних кутках */}
      <TouchableOpacity style={styles.sosFab} onPress={() => setShowSosModal(true)}>
        <Text style={styles.sosFabIcon}>🚨</Text>
        <Text style={styles.sosFabText}>SOS</Text>
      </TouchableOpacity>

      {!checkedIn ? (
        <TouchableOpacity style={styles.safeFab} onPress={handleCheckIn}>
          <Text style={styles.safeFabIcon}>🛡️</Text>
          <Text style={styles.safeFabText}>Безпека</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.safeFab, styles.safeFabConfirmed]}>
          <Text style={styles.safeFabIcon}>✅</Text>
          <Text style={styles.safeFabText}>OK</Text>
        </View>
      )}

      <SosModal
        visible={showSosModal}
        onClose={() => setShowSosModal(false)}
        onStandardSos={handleStandardSos}
        onEditedSos={handleEditedSos}
        timeoutSeconds={30}
      />
    </View>
  );
}

export function RequestCard({ request, onPress, initialSaved, userLocation }: { request: Request; onPress: () => void; initialSaved?: boolean; userLocation?: {latitude: number, longitude: number} | null }) {
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
          if (item) await safeWrite(() => item.destroyPermanently());
        } catch (localErr) {
          OfflineLogger.cache('RequestCard: failed to remove local bookmark', localErr);
        }
      } else {
        await requestsApi.save(request.id);
        setIsSaved(true);
        // Add to local DB quietly
        try {
          await safeWrite(() =>
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

  const assignedStyle = (request as any).isUserAssigned
    ? { borderLeftWidth: 4, borderLeftColor: Colors.primary }
    : (request as any).isMyOrgDelegating
    ? { borderLeftWidth: 4, borderLeftColor: Colors.secondary }
    : undefined;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card style={assignedStyle}>
        {(request as any).isUserAssigned && (
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: Colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, zIndex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.primary }}>👤 Я ВИКОНУЮ</Text>
          </View>
        )}
        {(request as any).isMyOrgDelegating && (
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, zIndex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.secondary }}>🏢 МОЯ ОРГАНІЗАЦІЯ</Text>
          </View>
        )}
        <View style={[styles.urgencyStrip, { backgroundColor: urgency?.bg ?? Colors.borderLight }]} />
        {(request as any).delegatedOrgNames?.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginHorizontal: 12 }}>
            {(request as any).delegatedOrgNames.slice(0, 3).map((name: string, i: number) => {
              const isMyOrg = (request as any).myDelegatedOrgNames?.includes(name);
              return (
                <Text key={i} style={{ fontSize: 11, color: isMyOrg ? Colors.primary : Colors.textMuted, fontWeight: isMyOrg ? '700' : '400' }}>
                  {isMyOrg ? `🏢 ${name}` : name}
                </Text>
              );
            })}
            {(request as any).delegatedOrgNames.length > 3 && (
              <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                ... +ще {(request as any).delegatedOrgNames.length - 3}
              </Text>
            )}
          </View>
        )}
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
                  <Text style={styles.metaText}>
                    📍 {requestLocationName}{request.isLocationHidden ? ' (приблизно)' : ''}
                    {userLocation ? ` • ${formatDistance(calculateDistance(userLocation.latitude, userLocation.longitude, request.latitude, request.longitude))}` : ''}
                  </Text>
                ) : (request.latitude && request.longitude) ? ( // Fallback to coordinates if name is not available but coordinates exist
                  <Text style={styles.metaText}>
                    📍 {Number(request.latitude).toFixed(3)}, {Number(request.longitude).toFixed(3)}{request.isLocationHidden ? ' (приблизно)' : ''}
                    {userLocation ? ` • ${formatDistance(calculateDistance(userLocation.latitude, userLocation.longitude, request.latitude, request.longitude))}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.metaText}>📍 Місце не вказано</Text>
                )}
              </>
            )
            : <Text style={styles.metaText}>📍 Місце не вказано</Text>}
          <Text style={styles.metaText}>🗂 {(request as any).taskCount ?? request.tasks?.length ?? 0} підзадач</Text>
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
  fabContainer: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    alignItems: 'flex-end',
    gap: 16,
  },
  sosFab: {
    position: 'absolute',
    left: 16,
    bottom: 20,
    backgroundColor: Colors.danger,
    borderRadius: 28,
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
    gap: 6,
  },
  sosFabIcon: {
    fontSize: 18,
  },
  sosFabText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  safeFab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    backgroundColor: Colors.secondary,
    borderRadius: 28,
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    gap: 6,
  },
  safeFabConfirmed: {
    backgroundColor: Colors.success,
    opacity: 0.7,
  },
  safeFabIcon: {
    fontSize: 16,
  },
  safeFabText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
