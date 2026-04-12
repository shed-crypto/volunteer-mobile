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
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Linking, TextInput,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../utils/theme';
import { requestsApi } from '../../api/requests.api';
import { Request } from '../../types';

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

export default function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
  const [mapMode, setMapMode]           = useState<'radius' | 'bounds' | 'all'>('radius');
  const [searchQuery, setSearchQuery]   = useState('');
  
  // Reverse geocoding state
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingError, setGeocodingError]   = useState<string | null>(null);

  // Debounce ref для слайдера
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Обробник зміни радіусу через текстове поле
  const handleRadiusChange = (text: string) => {
    const value = parseInt(text) || 1;
    // Обмежуємо максимальне значення радіусу щоб уникнути помилок API
    const maxRadius = 500; // Максимальний радіус 50 км (зменшено для уникнення помилок API)
    const boundedValue = Math.min(value, maxRadius);
    setSliderValue(boundedValue);
    // Оновлюємо радіус одразу для кращої UX
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      setRadiusKm(boundedValue);
    }, 500);
  };

  // Функція пошуку за адресою
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

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
        mapRef.current?.animateToRegion(region, 1000);
      }
    } catch (error) {
      console.error('Geocode error:', error);
      alert('Не вдалося знайти місце за цим запитом');
    }
  }, [searchQuery]);

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
        mapRef.current?.animateToRegion(newRegion, 800);
      } catch {
        // GPS може бути недоступний — продовжуємо з DEFAULT_REGION
      }
    })();
  }, []);

  // Оновлюємо межі карти при зміні регіону
  const handleRegionChange = (region: Region) => {
    regionRef.current = region;
    setMapBounds(region);
  };

  // ─── Завантаження заявок ──────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      let data: Request[] = [];
      
      if (mapMode === 'radius') {
        const center = userLocation ?? {
          latitude:  regionRef.current.latitude,
          longitude: regionRef.current.longitude,
        };
        data = await requestsApi.getNearby({ ...center, radiusKm });
    } else if (mapMode === 'bounds' && mapBounds) {
      // Для режиму меж отримуємо всі заявки та фільтруємо клієнтське
      // (backend не підтримує параметри latitude/longitude в getAll endpoint)
      data = await requestsApi.getAll({ limit: 1000 });
      
      // Фільтруємо за межами карти клієнтське
      if (data.length > 0) {
        const { latitude: centerLat, longitude: centerLng, latitudeDelta: latDelta, longitudeDelta: lngDelta } = mapBounds;
        const latMin = centerLat - latDelta/2;
        const latMax = centerLat + latDelta/2;
        const lngMin = centerLng - lngDelta/2;
        const lngMax = centerLng + lngDelta/2;
        
        data = data.filter(pin => 
          pin.latitude !== undefined && 
          pin.longitude !== undefined &&
          pin.latitude >= latMin && 
          pin.latitude <= latMax &&
          pin.longitude >= lngMin &&
          pin.longitude <= lngMax
        );
      }
     } else {
         // Режим 'all' - отримуємо всі заявки
         //Backend має обмеження на limit не більше 200
         data = await requestsApi.getAll({ limit: 200 });
       }
      
      setPins(data);
    } catch (err) {
      console.error('Failed to load requests:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userLocation, radiusKm, mapMode, mapBounds]);

  // Завантажуємо при зміні параметрів
  useEffect(() => { loadRequests(); }, [loadRequests]);

  // Перезавантажуємо коли таб стає активним (після переходу з інших екранів)
  useFocusEffect(useCallback(() => { loadRequests(); }, [loadRequests]));

  // ─── Обробник слайдера з debounce ─────────────────────────────────────────
  const handleSliderChange = (v: number) => {
    const rounded = Math.round(v);
    setSliderValue(rounded);
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      setRadiusKm(rounded);
    }, 500);
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

  // Функція кластеризації маркерів
  const renderClusteredMarkers = () => {
    // Якщо мало точок, показуємо їх всіх окремо
    if (pins.length <= 10) {
      return pins.map((pin) => {
        if (!pin.latitude || !pin.longitude) return null;
        const lat = Number(pin.latitude);
        const lng = Number(pin.longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        const urgencyKey = (pin.urgency ?? '').toLowerCase();
        return (
          <Marker
            key={pin.id}
            coordinate={{ latitude: lat, longitude: lng }}
            onPress={async () => {
              setSelected(pin);
              await fetchAddress(lat, lng, pin.isLocationHidden);
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
    const clusteredPins: Array<{ pin: Request; count: number }> = [];
    const used = new Set<number>();
    
    for (let i = 0; i < pins.length; i++) {
      if (used.has(i)) continue;
      
      const pin1 = pins[i];
      if (!pin1.latitude || !pin1.longitude) continue;
      
      let count = 1;
      let sumLat = Number(pin1.latitude);
      let sumLng = Number(pin1.longitude);
      
      for (let j = i + 1; j < pins.length; j++) {
        if (used.has(j)) continue;
        
        const pin2 = pins[j];
        if (!pin2.latitude || !pin2.longitude) continue;
        
        const lat1 = Number(pin1.latitude);
        const lng1 = Number(pin1.longitude);
        const lat2 = Number(pin2.latitude);
        const lng2 = Number(pin2.longitude);
        
        // Якщо відстань менше 0.05 градусов (приблизно 5km), групуємо
        if (Math.abs(lat1 - lat2) < 0.05 && Math.abs(lng1 - lng2) < 0.05) {
          count++;
          sumLat += lat2;
          sumLng += lng2;
          used.add(j);
        }
      }
      
      used.add(i);
      clusteredPins.push({
        pin: {
          ...pin1,
          latitude: sumLat / count,
          longitude: sumLng / count
        } as Request,
        count
      });
    }
    
    return clusteredPins.map(({ pin, count }, index) => {
      if (!pin.latitude || !pin.longitude) return null;
      const lat = Number(pin.latitude);
      const lng = Number(pin.longitude);
      if (isNaN(lat) || isNaN(lng)) return null;
      const urgencyKey = (pin.urgency ?? '').toLowerCase();
      
      return (
        <Marker
          key={pin.id + '_cluster_' + index}
          coordinate={{ latitude: lat, longitude: lng }}
          onPress={() => setSelected(pin)}
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
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={DEFAULT_REGION}
        onRegionChangeComplete={(r) => { regionRef.current = r; }}
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
      <View style={styles.radiusCard}>
        <TextInput
          placeholder="Радіус (км)"
          style={styles.radiusInput}
          value={sliderValue.toString()}
          onChangeText={handleRadiusChange}
          keyboardType="numeric"
        />
        <Text style={styles.radiusValueText}>км</Text>
      </View>
      
      {/* Пошук за адресою */}
      <View style={styles.searchCard}>
        <TextInput
          placeholder="Шукати за адресою..."
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Знайти</Text>
        </TouchableOpacity>
      </View>
      
      {/* Вибір режиму карти - переміщено вниз */}
      <View style={styles.modeCardBottom}>
        <View style={styles.modeSelectorBottom}>
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'radius' && styles.modeButtonActive]}
            onPress={() => setMapMode('radius')}
          >
            <Text style={styles.modeButtonText}>Радіус</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'bounds' && styles.modeButtonActive]}
            onPress={() => setMapMode('bounds')}
          >
            <Text style={styles.modeButtonText}>Межі</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.modeButton, mapMode === 'all' && styles.modeButtonActive]}
            onPress={() => setMapMode('all')}
          >
            <Text style={styles.modeButtonText}>Все</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Inline помилка — НЕ Alert щоб не блокувати UI */}
      {loadError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Не вдалося завантажити заявки</Text>
          <TouchableOpacity onPress={loadRequests}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Кнопка "Моя локація" */}
      <TouchableOpacity
        style={styles.myLocationBtn}
        onPress={() => {
          if (userLocation) {
            const r: Region = { ...userLocation, latitudeDelta: 0.1, longitudeDelta: 0.1 };
            regionRef.current = r;
            mapRef.current?.animateToRegion(r, 500);
          }
        }}
      >
        <Text style={styles.myLocationIcon}>◎</Text>
      </TouchableOpacity>

      {/* Лічильник заявок */}
      {!loading && pins.length > 0 && (
        <View style={styles.pinsCounter}>
          <Text style={styles.pinsCounterText}>📍 {pins.length} заявок</Text>
        </View>
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {/* Картка вибраної заявки */}
      {selected && (() => {
        const urgencyKey = (selected.urgency ?? '').toLowerCase();
        return (
          <View style={styles.infoCard}>
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
            {selected.latitude && selected.longitude && (
              <View style={{ marginVertical: 8 }}>
                {geocodingLoading ? (
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center' }}>
                    Визначаємо місцезнаходження...
                  </Text>
                ) : geocodingError ? (
                  <Text style={{ fontSize: 13, color: '#C62828', textAlign: 'center' }}>
                    {geocodingError}
                  </Text>
                ) : selectedAddress ? (
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center' }}>
                    📍 {selectedAddress}{selected.isLocationHidden ? ' (приблизно)' : ''}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center' }}>
                    📍 {Number(selected.latitude).toFixed(4)}, {Number(selected.longitude).toFixed(4)}{selected.isLocationHidden ? ' (приблизно)' : ''}
                  </Text>
                )}
              </View>
            )}

            {selected.latitude && !selected.isLocationHidden && (
              <TouchableOpacity
                style={styles.mapsBtn}
                onPress={() => openInMaps(Number(selected.latitude), Number(selected.longitude), selected.title)}
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

      {/* Легенда */}
      <View style={styles.legend}>
        {Object.entries(urgencyLabel).map(([key, label]) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: urgencyColor[key] }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map:       { flex: 1 },

   sliderCard: {
     position: 'absolute', top: 12, left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 12, padding: 12,
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.15, shadowRadius: 4, elevation: 5,
   },
   sliderLabel:  { fontSize: 14, fontWeight: '600', color: '#333', textAlign: 'center', marginBottom: 2 },
   slider:       { width: '100%', height: 40 },
   sliderLimits: { flexDirection: 'row', justifyContent: 'space-between' },
   sliderLimit:  { fontSize: 11, color: '#888' },

   searchCard: {
     position: 'absolute', top: 70, left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 12, padding: 12,
     flexDirection: 'row',
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.15, shadowRadius: 4, elevation: 5,
   },
   searchInput: {
     flex: 1,
     fontSize: 14,
     paddingVertical: 8,
     paddingHorizontal: 12,
     borderWidth: 1,
     borderColor: '#ddd',
     borderRadius: 6,
     color: '#333',
   },
   searchButton: {
     backgroundColor: Colors.primary,
     borderRadius: 6,
     paddingVertical: 8,
     paddingHorizontal: 12,
     marginLeft: 8,
     justifyContent: 'center',
     alignItems: 'center'
   },
   searchButtonText: {
     color: 'white',
     fontWeight: '600',
     fontSize: 14,
   },

   errorBanner: {
     position: 'absolute', top: 120, left: 12, right: 12,
     backgroundColor: '#FFEBEE', borderRadius: 10, padding: 10,
     flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
     borderWidth: 1, borderColor: '#EF9A9A', elevation: 4,
   },
   errorText:  { fontSize: 13, color: '#C62828', flex: 1 },
   retryText:  { fontSize: 13, fontWeight: '700', color: Colors.primary, marginLeft: 8 },

   myLocationBtn: {
     position: 'absolute', right: 16, bottom: 112,
     width: 44, height: 44, borderRadius: 22,
     backgroundColor: 'white', alignItems: 'center', justifyContent: 'center',
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.2, shadowRadius: 3, elevation: 4,
   },
   myLocationIcon: { fontSize: 22, color: Colors.primary },

   pinsCounter: {
     position: 'absolute', top: 12, alignSelf: 'center',
     backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 20,
     paddingHorizontal: 14, paddingVertical: 6,
     shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
     shadowOpacity: 0.15, shadowRadius: 2, elevation: 3,
   },
   pinsCounterText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

   loadingOverlay: {
     ...StyleSheet.absoluteFillObject,
     backgroundColor: 'rgba(255,255,255,0.35)',
     alignItems: 'center', justifyContent: 'center',
   },

   infoCard: {
     position: 'absolute', bottom: 80, left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 16, padding: 16,
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
  mapsBtn: {
    backgroundColor: '#E8F5E9', borderRadius: 8,
    paddingVertical: 8, alignItems: 'center', marginBottom: 8,
    borderWidth: 1, borderColor: '#4CAF50',
  },
  mapsBtnText: { color: '#2E7D32', fontWeight: '600', fontSize: 13 },
  detailsBtn:  { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  detailsBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  legend: {
    position: 'absolute', bottom: 16, left: 12,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, padding: 8,
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

   // Нові стилі для вибору режиму та пошуку
   modeSelector: {
     flexDirection: 'row',
     justifyContent: 'space-around',
     marginTop: 8,
     backgroundColor: 'rgba(255,255,255,0.8)',
     borderRadius: 8,
     padding: 4,
   },
   modeButton: {
     paddingVertical: 6,
     paddingHorizontal: 12,
     borderRadius: 4,
     backgroundColor: 'rgba(0,0,0,0.05)', // Фоновий колір для кращої видимості
     borderWidth: 1,
     borderColor: 'rgba(0,0,0,0.1)',
   },
   modeButtonActive: {
     backgroundColor: Colors.primary,
   },
   modeButtonText: {
     color: 'white',
     fontWeight: '600',
     fontSize: 12,
   },
   
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
   
   // Нові стилі для поля вводу радіусу та нижнього меню
   radiusCard: {
     position: 'absolute', top: 12, left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 12, padding: 12,
     flexDirection: 'row', alignItems: 'center',
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.15, shadowRadius: 4, elevation: 5,
   },
   radiusInput: {
     flex: 1,
     fontSize: 16,
     paddingVertical: 8,
     paddingHorizontal: 12,
     borderWidth: 1,
     borderColor: '#ddd',
     borderRadius: 6,
     color: '#333',
   },
   radiusValueText: {
     fontSize: 16,
     fontWeight: '600',
     color: '#333',
     marginLeft: 4,
   },
   
   modeCardBottom: {
     position: 'absolute', bottom: 62, left: 12, right: 12,
     backgroundColor: 'white', borderRadius: 12, padding: 12,
     shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
     shadowOpacity: 0.15, shadowRadius: 4, elevation: 5,
   },
   modeSelectorBottom: {
     flexDirection: 'row',
     justifyContent: 'space-around',
     backgroundColor: 'rgba(255,255,255,0.8)',
     borderRadius: 8,
     padding: 4,
   },
});