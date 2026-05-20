/**
 * MapScreen.tsx
 *
 * БАГ-ФІКси:
 * 1. Slider не відображається / не працює при першому рендері на Android —
 *    причина: `onSlidingComplete` не завжди спрацьовує. Замінено на
 *    `onValueChange` + debounce (500ms) щоб не спамити API при перетягуванні.
 * 2. Коло не показувалось бо userLocation був null при першому рендері —
 *    тепер circle показується від DEFAULT_REGION якщо GPS ще не визначено.
 * 3. Піни не завантажувались — основний баг: exactLocation не встановлювалось
 *    при створенні заявки (виправлено в requests.service.ts бекенду).
 *    Також: urgency у бекенді lowercase ('low','high'), але urgencyColor/Label
 *    використовував UPPERCASE ключі — виправлено.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Linking, TextInput, Alert, ScrollView,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, categoryLabels, statusColors } from '../../utils/theme';
import { OfflineLogger } from '../../utils/offlineLogger';
import { requestsApi } from '../../api/requests.api';
import { SyncService } from '../../db/SyncService';
import { Request, RequestCategory, RequestStatus, RequestUrgency } from '../../types';

type RootStackParamList = {
  MapMain: undefined;
  RequestDetail: { requestId: string };
};

// Бекенд повертає urgency lowercase: 'low','medium','high','critical'
const urgencyColor: Record<string, string> = {
  low:      '#4CAF50',
  medium:   '#FF9800',
  high:     '#F44336',
  critical: '#9C27B0',
};

const urgencyLabel: Record<string, string> = {
  low:      'Низька',
  medium:   'Середня',
  high:     'Висока',
  critical: 'Критична',
};

const DEFAULT_REGION: Region = {
  latitude:      50.4501,
  longitude:     30.5234,
  latitudeDelta:  0.5,
  longitudeDelta: 0.5,
};

const MAX_RADIUS_KM = 100;
const RADIUS_PRESETS = [5, 10, 25, 50, 100];

type MapMode = 'radius' | 'bounds' | 'all';

type SearchSuggestion = {
  id: string;
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
};

type MapFilters = {
  category?: RequestCategory;
  urgency?: RequestUrgency;
  status?: RequestStatus;
};

const allCategories = Object.values(RequestCategory);
const allUrgencies = Object.values(RequestUrgency);
const allStatuses = [
  RequestStatus.OPEN,
  RequestStatus.IN_PROGRESS,
  RequestStatus.PENDING_REVIEW,
  RequestStatus.COMPLETED,
];

const statusLabel: Record<string, string> = Object.fromEntries(
  Object.entries(statusColors).map(([key, value]) => [key, value.label]),
);

const activeFilterCount = (filters: MapFilters) =>
  [filters.category, filters.urgency, filters.status].filter(Boolean).length;

const compactCategoryLabel = (category: RequestCategory) =>
  (categoryLabels[category] ?? category).replace(/^[^\s]+\s/, '').slice(0, 11);

const getPinCoordinate = (pin: Request) => {
  if (pin.latitude == null || pin.longitude == null) return null;

  const latitude = Number(pin.latitude);
  const longitude = Number(pin.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
};

export default function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // region у ref щоб не тригерити useCallback при кожному русі карти
  const regionRef = useRef<Region>(DEFAULT_REGION);
  const [mapBounds, setMapBounds] = useState<Region | null>(null);

  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [sliderValue, setSliderValue]   = useState(10);
  const [radiusKm, setRadiusKm]         = useState(10);
  const [pins, setPins]                 = useState<Request[]>([]);
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState(false);
  const [selected, setSelected]         = useState<Request | null>(null);
  const [mapMode, setMapMode]           = useState<MapMode>('radius');
  const [filters, setFilters]           = useState<MapFilters>({});
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [searchQuery, setSearchQuery]   = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  
  // Reverse geocoding state
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingError, setGeocodingError]   = useState<string | null>(null);

  // Debounce ref для слайдера
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeqRef = useRef(0);

  const topOffset = insets.top + 8;
  const bottomOffset = insets.bottom + 12;
  const topPanelHeight = mapMode === 'radius' ? 156 : 98;
  const bottomPanelHeight = filtersOpen ? 252 : 98;
  const selectedCardBottom = bottomOffset + bottomPanelHeight + 10;

  useEffect(() => {
    return () => {
      if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const commitRadius = useCallback((value: number) => {
    const boundedValue = Math.max(1, Math.min(Math.round(value), MAX_RADIUS_KM));
    setSliderValue(boundedValue);
    setRadiusKm(boundedValue);
  }, []);

  // Обробник зміни радіусу через текстове поле
  const handleRadiusChange = (text: string) => {
    const numeric = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
    const value = Number.isFinite(numeric) ? numeric : 1;
    const boundedValue = Math.max(1, Math.min(value, MAX_RADIUS_KM));
    setSliderValue(boundedValue);
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      setRadiusKm(boundedValue);
    }, 250);
  };

  const fetchSearchSuggestions = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchSuggestions([]);
      return;
    }

    setSuggestionsLoading(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=4&accept-language=uk&q=${encodeURIComponent(trimmed)}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VolunteerApp/1.0',
          },
        },
      );
      const results = await response.json();
      if (!Array.isArray(results)) {
        setSearchSuggestions([]);
        return;
      }

      const suggestions = results
        .map((item: any, index: number): SearchSuggestion | null => {
          const latitude = Number(item.lat);
          const longitude = Number(item.lon);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

          const address = item.address ?? {};
          const title =
            address.city ||
            address.town ||
            address.village ||
            address.municipality ||
            address.county ||
            item.name ||
            item.display_name?.split(',')[0] ||
            trimmed;
          const subtitleParts = [
            address.state,
            address.country,
          ].filter(Boolean);

          return {
            id: String(item.place_id ?? `${latitude}_${longitude}_${index}`),
            title,
            subtitle: subtitleParts.join(', '),
            latitude,
            longitude,
          };
        })
        .filter(Boolean) as SearchSuggestion[];

      setSearchSuggestions(suggestions);
    } catch (error) {
      console.error('Search suggestions error:', error);
      setSearchSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const handleSearchQueryChange = (text: string) => {
    setSearchQuery(text);
    setSelected(null);
    setFiltersOpen(false);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchSearchSuggestions(text);
    }, 350);
  };

  const goToSuggestion = useCallback((suggestion: SearchSuggestion) => {
    const region: Region = {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    };
    setSearchQuery([suggestion.title, suggestion.subtitle].filter(Boolean).join(', '));
    setSearchSuggestions([]);
    setSearchFocused(false);
    regionRef.current = region;
    setMapBounds(region);
    mapRef.current?.animateToRegion(region, 700);
  }, []);

  // Функція пошуку за адресою
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    if (searchSuggestions.length > 0) {
      goToSuggestion(searchSuggestions[0]);
      return;
    }

    try {
      const location = await Location.geocodeAsync(searchQuery);
      if (location.length > 0) {
        const { latitude, longitude } = location[0];
        const region: Region = {
          latitude,
          longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        };
        regionRef.current = region;
        setMapBounds(region);
        setSearchFocused(false);
        setSearchSuggestions([]);
        mapRef.current?.animateToRegion(region, 1000);
      } else {
        Alert.alert('Нічого не знайдено', 'Спробуйте уточнити місто, країну або адресу.');
      }
    } catch (error) {
      console.error('Geocode error:', error);
      Alert.alert('Пошук недоступний', 'Не вдалося знайти місце за цим запитом');
    }
  }, [goToSuggestion, searchQuery, searchSuggestions]);

  // Функція отримання адреси за координатами (reverse geocoding)
  const fetchAddress = useCallback(async (latitude: number, longitude: number, isLocationHidden: boolean = false) => {
    setGeocodingLoading(true);
    setGeocodingError(null);
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (addresses.length > 0) {
        const address = addresses[0];
        // Формуємо читабельну адресу з доступних компонентів
        let parts = [];
        if (address.city) parts.push(address.city);
        if (address.region && address.region !== address.city) parts.push(address.region);
        if (!isLocationHidden && address.street) parts.push(address.street);
        if (!isLocationHidden && address.name && address.name !== address.street) parts.push(address.name);
        
        const formattedAddress = parts.filter(Boolean).join(', ');
        setSelectedAddress(formattedAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      } else {
        setSelectedAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      setGeocodingError('Не вдалося визначити місцеоположення');
      setSelectedAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
    } finally {
      setGeocodingLoading(false);
    }
  }, []);

  // ─── GPS ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(coords);
        const newRegion: Region = { ...coords, latitudeDelta: 0.15, longitudeDelta: 0.15 };
        regionRef.current = newRegion;
        setMapBounds(newRegion);
        mapRef.current?.animateToRegion(newRegion, 800);
      } catch {
        // GPS може бути недоступний — продовжуємо з DEFAULT_REGION
      }
    })();
  }, []);

  // Throttle: не частіше ніж раз на 5 секунд
  const lastLoadRef = useRef(0);
  const throttledLoadRef = useRef<(() => Promise<void>) | null>(null);

  // Оновлюємо межі карти при зміні регіону, але НЕ тригеримо завантаження
  const handleRegionChange = useCallback((region: Region) => {
    const oldRegion = regionRef.current;
    // Перевіряємо чи карта реально змістилась (значна зміна позиції чи масштабу)
    const hasMoved = 
      Math.abs(region.latitude - oldRegion.latitude) > 0.001 ||
      Math.abs(region.longitude - oldRegion.longitude) > 0.001 ||
      Math.abs(region.latitudeDelta - oldRegion.latitudeDelta) > 0.01 ||
      Math.abs(region.longitudeDelta - oldRegion.longitudeDelta) > 0.01;
    
    regionRef.current = region;
    setMapBounds(region);
    
    // Завантажуємо тільки якщо карта реально змістилась і це режим 'bounds'
    if (hasMoved && mapMode === 'bounds') {
      throttledLoadRef.current?.();
    }
  }, [mapMode]);

  // ─── Завантаження заявок ──────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      let data: Request[] = [];
      
      if (mapMode === 'radius') {
        const center = userLocation ?? {
          latitude:  regionRef.current.latitude,
          longitude: regionRef.current.longitude,
        };
        data = await requestsApi.getAll({ ...filters, ...center, radiusKm, limit: 100 });
    } else if (mapMode === 'bounds') {
      // Для режиму меж отримуємо всі заявки та фільтруємо клієнтське
      // (backend не підтримує параметри latitude/longitude в getAll endpoint)
      data = await requestsApi.getAll({ ...filters, limit: 200 });
      
      // Фільтруємо за межами карти клієнтське
      const bounds = mapBounds ?? regionRef.current;
      if (data.length > 0) {
        const { latitude: centerLat, longitude: centerLng, latitudeDelta: latDelta, longitudeDelta: lngDelta } = bounds;
        const latMin = centerLat - latDelta/2;
        const latMax = centerLat + latDelta/2;
        const lngMin = centerLng - lngDelta/2;
        const lngMax = centerLng + lngDelta/2;
        
        data = data.filter((pin) => {
          const coordinate = getPinCoordinate(pin);
          return Boolean(
            coordinate &&
            coordinate.latitude >= latMin &&
            coordinate.latitude <= latMax &&
            coordinate.longitude >= lngMin &&
            coordinate.longitude <= lngMax
          );
        });
      }
     } else {
         // Режим 'all' - отримуємо всі заявки
         //Backend має обмеження на limit не більше 200
         data = await requestsApi.getAll({ ...filters, limit: 200 });
       }
      
      if (seq === loadSeqRef.current) {
        setPins(data);
      }
    } catch (err) {
      console.error('Failed to load requests:', err);
      if (seq === loadSeqRef.current) {
        setLoadError(true);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [userLocation, radiusKm, mapMode, mapBounds, filters]);

  // Throttled load: не частіше ніж раз на 5 секунд
  const throttledLoad = useCallback(async () => {
    const now = Date.now();
    if (now - lastLoadRef.current < 5000) {
      OfflineLogger?.nav?.('MapScreen: load throttled');
      return;
    }
    lastLoadRef.current = now;
    await loadRequests();
  }, [loadRequests]);

  // Sync ref for handleRegionChange (avoids circular dependency)
  throttledLoadRef.current = throttledLoad;

  // Завантажуємо тільки при зміні режиму, радіусу або фільтрів (не при фокусі таба)
  useEffect(() => {
    throttledLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode, radiusKm, filters]);

  // SyncService listener: оновлюємо після синхронізації
  useEffect(() => {
    const unsub = SyncService.on('sync-event', () => {
      throttledLoad();
    });
    return unsub;
  }, [throttledLoad]);

  // ─── Обробник слайдера з debounce ─────────────────────────────────────────
  const handleSliderChange = (v: number) => {
    const rounded = Math.round(v);
    setSliderValue(rounded);
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      setRadiusKm(rounded);
    }, 350);
  };

  const openInMaps = (lat: number, lng: number, title: string) => {
    const label = encodeURIComponent(title);
    const url = Platform.select({
      ios:     `maps:0,0?q=${label}@${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
    });
    if (url) Linking.openURL(url).catch(() =>
      Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)
    );
  };

  const visiblePins = useMemo(
    () => pins.filter((pin) => Boolean(getPinCoordinate(pin))),
    [pins],
  );

  const setFilter = useCallback(<K extends keyof MapFilters>(key: K, value: MapFilters[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: current[key] === value ? undefined : value,
    }));
  }, []);

  const clearFilters = useCallback(() => setFilters({}), []);

  const handleModeChange = useCallback((mode: MapMode) => {
    setSelected(null);
    setSearchFocused(false);
    setMapMode(mode);
  }, []);

  // Функція кластеризації маркерів
  const renderClusteredMarkers = () => {
    // Якщо мало точок, показуємо їх всіх окремо
    if (visiblePins.length <= 10) {
      return visiblePins.map((pin) => {
        const coordinate = getPinCoordinate(pin);
        if (!coordinate) return null;
        const urgencyKey = (pin.urgency ?? '').toLowerCase();
        return (
          <Marker
            key={pin.id}
            coordinate={coordinate}
            onPress={async () => {
              setFiltersOpen(false);
              setSelected(pin);
              setSelectedAddress(null);
              await fetchAddress(coordinate.latitude, coordinate.longitude, pin.isLocationHidden);
            }}
          >
            <View style={[styles.markerDot, { backgroundColor: urgencyColor[urgencyKey] ?? '#999' }]}>
              {pin.isLocationHidden && <Text style={styles.markerLock}>~</Text>}
            </View>
          </Marker>
        );
      });
    }

    // Проста кластеризація: групуємо точки, що близько один до одного
    const clusteredPins: Array<{ coordinate: { latitude: number; longitude: number }; pins: Request[] }> = [];
    const used = new Set<number>();
    
    for (let i = 0; i < visiblePins.length; i++) {
      if (used.has(i)) continue;
      
      const pin1 = visiblePins[i];
      const coordinate1 = getPinCoordinate(pin1);
      if (!coordinate1) continue;
      
      const clusterPins = [pin1];
      let sumLat = coordinate1.latitude;
      let sumLng = coordinate1.longitude;
      
      for (let j = i + 1; j < visiblePins.length; j++) {
        if (used.has(j)) continue;
        
        const pin2 = visiblePins[j];
        const coordinate2 = getPinCoordinate(pin2);
        if (!coordinate2) continue;
        
        // Якщо відстань менше 0.05 градусов (приблизно 5km), групуємо
        if (
          Math.abs(coordinate1.latitude - coordinate2.latitude) < 0.05 &&
          Math.abs(coordinate1.longitude - coordinate2.longitude) < 0.05
        ) {
          clusterPins.push(pin2);
          sumLat += coordinate2.latitude;
          sumLng += coordinate2.longitude;
          used.add(j);
        }
      }
      
      used.add(i);
      clusteredPins.push({
        coordinate: {
          latitude: sumLat / clusterPins.length,
          longitude: sumLng / clusterPins.length,
        },
        pins: clusterPins,
      });
    }
    
    return clusteredPins.map(({ coordinate, pins: clusterPins }, index) => {
      const firstPin = clusterPins[0];
      const count = clusterPins.length;
      const urgencyKey = (firstPin.urgency ?? '').toLowerCase();
      
      return (
        <Marker
          key={firstPin.id + '_cluster_' + index}
          coordinate={coordinate}
          onPress={async () => {
            if (count > 1) {
              const region: Region = {
                ...coordinate,
                latitudeDelta: Math.max(regionRef.current.latitudeDelta / 2, 0.03),
                longitudeDelta: Math.max(regionRef.current.longitudeDelta / 2, 0.03),
              };
              regionRef.current = region;
              setMapBounds(region);
              mapRef.current?.animateToRegion(region, 450);
              return;
            }

            setSelected(firstPin);
            setFiltersOpen(false);
            setSelectedAddress(null);
            await fetchAddress(coordinate.latitude, coordinate.longitude, firstPin.isLocationHidden);
          }}
        >
          <View style={[styles.clusterDot, { backgroundColor: urgencyColor[urgencyKey] ?? '#999' }]}>
            {count > 1 && <Text style={styles.clusterText}>{count}</Text>}
          </View>
        </Marker>
      );
    });
  };

  // Центр для кола — GPS або DEFAULT_REGION
  const circleCenter = userLocation ?? {
    latitude:  DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={DEFAULT_REGION}
        mapPadding={{
          top: topOffset + topPanelHeight + 12,
          right: 10,
          bottom: bottomOffset + bottomPanelHeight + 12,
          left: 10,
        }}
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {/* Коло радіусу — показуємо тільки в режимі радіусу */}
        {mapMode === 'radius' && (
          <Circle
            center={circleCenter}
            radius={radiusKm * 1000}
            strokeColor={Colors.primary}
            strokeWidth={1.5}
            fillColor="rgba(26,86,219,0.07)"
          />
        )}

        {/* Маркери заявок з кластеризацією */}
        {renderClusteredMarkers()}
      </MapView>

      {/* Поле вводу радіусу та вибір режиму */}
      <View style={[styles.controlsCard, { top: topOffset }]}>
        <View style={styles.searchRow}>
          <TextInput
            placeholder="Шукати адресу або місто"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleSearchQueryChange}
            onSubmitEditing={handleSearch}
            onFocus={() => {
              setSearchFocused(true);
              setSelected(null);
              setFiltersOpen(false);
            }}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
            <Text style={styles.searchButtonText}>Пошук</Text>
          </TouchableOpacity>
        </View>

        {searchFocused && (searchSuggestions.length > 0 || suggestionsLoading) && (
          <View style={styles.suggestionsMenu}>
            {suggestionsLoading && (
              <View style={styles.suggestionRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.suggestionTitle}>Шукаємо місця...</Text>
              </View>
            )}
            {searchSuggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion.id}
                style={styles.suggestionRow}
                onPress={() => goToSuggestion(suggestion)}
              >
                <Text style={styles.suggestionIcon}>⌕</Text>
                <View style={styles.suggestionTextBlock}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>{suggestion.title}</Text>
                  {suggestion.subtitle ? (
                    <Text style={styles.suggestionSubtitle} numberOfLines={1}>{suggestion.subtitle}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {mapMode === 'radius' && (
          <View style={styles.radiusSection}>
            <View style={styles.radiusHeader}>
              <Text style={styles.mapSummaryText}>📍 {visiblePins.length} заявок</Text>
              <Text style={styles.radiusLabel}>Радіус</Text>
              <TextInput
                style={styles.radiusInput}
                value={sliderValue.toString()}
                onChangeText={handleRadiusChange}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Text style={styles.radiusValueText}>км</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={MAX_RADIUS_KM}
              step={1}
              value={sliderValue}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.primary}
              onValueChange={handleSliderChange}
              onSlidingComplete={commitRadius}
            />
            <View style={styles.radiusPresetRow}>
              {RADIUS_PRESETS.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.radiusPreset, radiusKm === value && styles.radiusPresetActive]}
                  onPress={() => commitRadius(value)}
                >
                  <Text style={[styles.radiusPresetText, radiusKm === value && styles.radiusPresetTextActive]}>
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {mapMode !== 'radius' && (
          <View style={styles.mapSummaryRow}>
            <Text style={styles.mapSummaryText}>📍 {visiblePins.length} заявок</Text>
            <Text style={styles.mapSummaryMuted}>
              {mapMode === 'bounds' ? 'У видимій області' : 'Усі доступні'}
            </Text>
          </View>
        )}
      </View>
      
      {/* Вибір режиму карти - переміщено вниз */}
      <View style={[styles.bottomPanel, { bottom: bottomOffset }]}>
        <View style={styles.modeSelectorBottom}>
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'radius' && styles.modeButtonActive]}
            onPress={() => handleModeChange('radius')}
          >
            <Text style={[styles.modeButtonText, mapMode === 'radius' && styles.modeButtonTextActive]}>Радіус</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'bounds' && styles.modeButtonActive]}
            onPress={() => handleModeChange('bounds')}
          >
            <Text style={[styles.modeButtonText, mapMode === 'bounds' && styles.modeButtonTextActive]}>У межах</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'all' && styles.modeButtonActive]}
            onPress={() => handleModeChange('all')}
          >
            <Text style={[styles.modeButtonText, mapMode === 'all' && styles.modeButtonTextActive]}>Усі</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterHeader}>
          <TouchableOpacity
            style={[styles.filterToggle, filtersOpen && styles.filterToggleActive]}
            onPress={() => {
              setSelected(null);
              setSearchFocused(false);
              setFiltersOpen((value) => !value);
            }}
          >
            <Ionicons
              name="options-outline"
              size={16}
              color={filtersOpen ? '#fff' : Colors.primary}
            />
            <Text style={[styles.filterToggleText, filtersOpen && styles.filterToggleTextActive]}>
              Фільтри{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}
            </Text>
          </TouchableOpacity>
          {activeFilterCount(filters) > 0 && (
            <TouchableOpacity onPress={clearFilters}>
              <Text style={styles.clearFiltersText}>Скинути</Text>
            </TouchableOpacity>
          )}
        </View>

        {filtersOpen && (
          <View style={styles.filtersBlock}>
            <Text style={styles.filterGroupTitle}>Категорія</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {allCategories.map((category) => (
                <TouchableOpacity
                  key={category}
                  style={[styles.filterChip, filters.category === category && styles.filterChipActive]}
                  onPress={() => setFilter('category', category)}
                >
                  <Text style={[styles.filterChipText, filters.category === category && styles.filterChipTextActive]} numberOfLines={1}>
                    {compactCategoryLabel(category)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.filterGroupTitle}>Терміновість</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {allUrgencies.map((urgency) => (
                <TouchableOpacity
                  key={urgency}
                  style={[styles.filterChip, filters.urgency === urgency && styles.filterChipActive]}
                  onPress={() => setFilter('urgency', urgency)}
                >
                  <Text style={[styles.filterChipText, filters.urgency === urgency && styles.filterChipTextActive]}>
                    {urgencyLabel[urgency]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.filterGroupTitle}>Статус</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {allStatuses.map((status) => (
                <TouchableOpacity
                  key={status}
                  style={[styles.filterChip, filters.status === status && styles.filterChipActive]}
                  onPress={() => setFilter('status', status)}
                >
                  <Text style={[styles.filterChipText, filters.status === status && styles.filterChipTextActive]}>
                    {statusLabel[status] ?? status}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {!filtersOpen && (
          <View style={styles.legendInline}>
            {Object.entries(urgencyLabel).map(([key, label]) => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: urgencyColor[key] }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      
      {/* Inline помилка — НЕ Alert щоб не блокувати UI */}
      {loadError && (
        <View style={[styles.errorBanner, { top: topOffset + 148 }]}>
          <Text style={styles.errorText}>Не вдалося завантажити заявки</Text>
          <TouchableOpacity onPress={loadRequests}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Кнопка "Моя локація" */}
      <TouchableOpacity
        style={[
          styles.myLocationBtn,
          { bottom: selected ? selectedCardBottom + 168 : bottomOffset + bottomPanelHeight + 12 },
        ]}
        onPress={() => {
          if (userLocation) {
            const r: Region = { ...userLocation, latitudeDelta: 0.1, longitudeDelta: 0.1 };
            regionRef.current = r;
            setMapBounds(r);
            mapRef.current?.animateToRegion(r, 500);
          }
        }}
        disabled={!userLocation}
      >
        <Text style={[styles.myLocationIcon, !userLocation && styles.myLocationIconDisabled]}>◎</Text>
      </TouchableOpacity>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {/* Картка вибраної заявки */}
      {selected && (() => {
        const urgencyKey = (selected.urgency ?? '').toLowerCase();
        const selectedCoordinate = getPinCoordinate(selected);
        return (
          <View style={[styles.infoCard, { bottom: selectedCardBottom }]}>
            <View style={styles.infoCardHeader}>
              <View style={[styles.urgencyBadge, { backgroundColor: urgencyColor[urgencyKey] ?? '#999' }]}>
                <Text style={styles.urgencyBadgeText}>{urgencyLabel[urgencyKey] ?? selected.urgency}</Text>
              </View>
              {selected.isLocationHidden && (
                <Text style={styles.obfuscatedNote}>📍 Приблизна локація</Text>
              )}
              <TouchableOpacity onPress={() => setSelected(null)} style={{ marginLeft: 'auto' }}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.infoCardTitle}>{selected.title}</Text>
            {selected.description ? (
              <Text style={styles.infoCardDesc} numberOfLines={2}>{selected.description}</Text>
            ) : null}

            {/* Показ location information */}
            {selectedCoordinate && (
              <View style={styles.addressBlock}>
                {geocodingLoading ? (
                  <Text style={styles.addressText}>
                    Визначаємо місцезнаходження...
                  </Text>
                ) : geocodingError ? (
                  <Text style={styles.addressErrorText}>
                    {geocodingError}
                  </Text>
                ) : selectedAddress ? (
                  <Text style={styles.addressText}>
                    📍 {selectedAddress}{selected.isLocationHidden ? ' (приблизно)' : ''}
                  </Text>
                ) : (
                  <Text style={styles.addressText}>
                    📍 {selectedCoordinate.latitude.toFixed(4)}, {selectedCoordinate.longitude.toFixed(4)}{selected.isLocationHidden ? ' (приблизно)' : ''}
                  </Text>
                )}
              </View>
            )}

            {selectedCoordinate && !selected.isLocationHidden && (
              <TouchableOpacity
                style={styles.mapsBtn}
                onPress={() => openInMaps(selectedCoordinate.latitude, selectedCoordinate.longitude, selected.title)}
              >
                <Text style={styles.mapsBtnText}>🗺 Відкрити в картах</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.detailsBtn}
              onPress={() => {
                setSelected(null);
                navigation.navigate('RequestDetail', { requestId: selected.id });
              }}
            >
              <Text style={styles.detailsBtnText}>Переглянути заявку →</Text>
            </TouchableOpacity>
          </View>
        );
      })()}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map:       { flex: 1 },

  controlsCard: {
    position: 'absolute', left: 12, right: 12,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16, shadowRadius: 8, elevation: 6,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  searchButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    minHeight: 42,
    paddingHorizontal: 14,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 13,
  },
  suggestionsMenu: {
    marginTop: 8,
    maxHeight: 190,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  suggestionRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 8,
  },
  suggestionIcon: { width: 18, fontSize: 16, color: Colors.primary, textAlign: 'center' },
  suggestionTextBlock: { flex: 1, minWidth: 0 },
  suggestionTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  suggestionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  mapSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  mapSummaryText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  mapSummaryMuted: { flex: 1, textAlign: 'right', fontSize: 12, color: Colors.textSecondary },
  radiusSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 8,
  },
  radiusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radiusLabel: { fontSize: 13, fontWeight: '700', color: Colors.text },
  radiusInput: {
    width: 44,
    minHeight: 30,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 7,
    color: Colors.text,
    textAlign: 'right',
    backgroundColor: Colors.surface,
  },
  radiusValueText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  slider: { width: '100%', height: 34 },
  radiusPresetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  radiusPreset: {
    flex: 1,
    minHeight: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  radiusPresetActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  radiusPresetText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  radiusPresetTextActive: { color: Colors.primary },

   errorBanner: {
     position: 'absolute', left: 12, right: 12,
     backgroundColor: '#FFEBEE', borderRadius: 10, padding: 10,
     flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
     borderWidth: 1, borderColor: '#EF9A9A', elevation: 4,
   },
   errorText:  { fontSize: 13, color: '#C62828', flex: 1 },
   retryText:  { fontSize: 13, fontWeight: '700', color: Colors.primary, marginLeft: 8 },

   myLocationBtn: {
     position: 'absolute', right: 16,
     width: 44, height: 44, borderRadius: 22,
     backgroundColor: 'white', alignItems: 'center', justifyContent: 'center',
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.2, shadowRadius: 3, elevation: 4,
   },
   myLocationIcon: { fontSize: 22, color: Colors.primary },
   myLocationIconDisabled: { color: Colors.textMuted },

   loadingOverlay: {
     ...StyleSheet.absoluteFillObject,
     backgroundColor: 'rgba(255,255,255,0.35)',
     alignItems: 'center', justifyContent: 'center',
   },

   infoCard: {
     position: 'absolute', left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 12, padding: 16,
     shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
     shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
   },
  infoCardHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  urgencyBadge:      { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  urgencyBadgeText:  { color: 'white', fontSize: 11, fontWeight: '700' },
  obfuscatedNote:    { fontSize: 11, color: '#888' },
  closeBtn:          { fontSize: 18, color: '#999', padding: 4 },
  infoCardTitle:     { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 4 },
  infoCardDesc:      { fontSize: 13, color: '#666', marginBottom: 8 },
  addressBlock:      { marginVertical: 8 },
  addressText:       { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  addressErrorText:  { fontSize: 13, color: '#C62828', textAlign: 'center' },
  mapsBtn: {
    backgroundColor: '#E8F5E9', borderRadius: 8,
    paddingVertical: 8, alignItems: 'center', marginBottom: 8,
    borderWidth: 1, borderColor: '#4CAF50',
  },
  mapsBtnText: { color: '#2E7D32', fontWeight: '600', fontSize: 13 },
  detailsBtn:  { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  detailsBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  legendInline: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    flexDirection: 'row', gap: 8, flexWrap: 'wrap',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:  { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, color: '#555' },

  markerDot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: 'white',
    alignItems: 'center', justifyContent: 'center',
  },
  markerLock: { fontSize: 8, color: 'white' },

   modeButton: {
     flex: 1,
     paddingVertical: 9,
     paddingHorizontal: 8,
     borderRadius: 7,
     alignItems: 'center',
   },
   modeButtonActive: {
     backgroundColor: Colors.primary,
   },
   modeButtonText: {
     color: Colors.textSecondary,
     fontWeight: '700',
     fontSize: 12,
   },
   modeButtonTextActive: { color: 'white' },
   
   // Стилі для кластеризації
   clusterDot: {
     width: 25, height: 25, borderRadius: 12,
     borderWidth: 2, borderColor: 'white',
     alignItems: 'center', justifyContent: 'center',
   },
   clusterText: {
     color: 'white',
     fontWeight: 'bold',
     fontSize: 10,
   },
   
   bottomPanel: {
     position: 'absolute', left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 10, padding: 6,
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.15, shadowRadius: 4, elevation: 5,
   },
   modeSelectorBottom: {
     flexDirection: 'row',
     backgroundColor: Colors.background,
     borderRadius: 8,
     padding: 3,
   },
   filterHeader: {
     minHeight: 40,
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     paddingHorizontal: 4,
     marginTop: 4,
   },
   filterToggle: {
     minHeight: 34,
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'center',
     gap: 6,
     paddingHorizontal: 12,
     borderRadius: 8,
     borderWidth: 1,
     borderColor: Colors.primary,
     backgroundColor: Colors.primaryLight,
   },
   filterToggleActive: {
     backgroundColor: Colors.primary,
   },
   filterToggleText: { color: Colors.primary, fontSize: 13, fontWeight: '800' },
   filterToggleTextActive: { color: '#fff' },
   clearFiltersText: { color: Colors.primary, fontSize: 12, fontWeight: '700', paddingHorizontal: 8 },
   filtersBlock: { gap: 4, paddingHorizontal: 4 },
   filterGroupTitle: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, marginTop: 2 },
   filterChipsRow: { gap: 6, paddingRight: 8 },
   filterChip: {
     minHeight: 30,
     maxWidth: 150,
     borderRadius: 15,
     borderWidth: 1,
     borderColor: Colors.border,
     paddingHorizontal: 10,
     alignItems: 'center',
     justifyContent: 'center',
     backgroundColor: Colors.surface,
   },
   filterChipActive: {
     borderColor: Colors.primary,
     backgroundColor: Colors.primary,
   },
   filterChipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
   filterChipTextActive: { color: '#fff' },
});
