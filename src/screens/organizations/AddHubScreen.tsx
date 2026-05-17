import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Image, ScrollView, Switch, Text, TouchableOpacity, TextInput as RNTextInput } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { orgsApi } from '../../api/orgs.api';
import { Button, Input, ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { getMediaUrl } from '../../utils/fileUtils';
import { Hub } from '../../types';

type LocationMode = 'none' | 'gps' | 'manual';

type RouteParams = { orgId: string; hubId?: string };

export default function AddHubScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { orgId, hubId } = route.params;
  const isEditing = Boolean(hubId);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [media, setMedia] = useState<string | null>(null);
  const [mediaChanged, setMediaChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  // Геолокація — три режими
  const [locMode, setLocMode] = useState<LocationMode>('none');
  const [latitudeNum, setLatitudeNum] = useState<number | undefined>();
  const [longitudeNum, setLongitudeNum] = useState<number | undefined>();
  const [locLoading, setLocLoading] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

  useEffect(() => {
    if (isEditing) loadHub();
  }, [hubId]);

  const loadHub = async () => {
    try {
      const hubs = await orgsApi.getHubs(orgId);
      const hub = hubs.find((item) => item.id === hubId);
      if (!hub) {
        Alert.alert('Помилка', 'Хаб не знайдено');
        navigation.goBack();
        return;
      }
      fillForm(hub);
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося завантажити хаб');
      navigation.goBack();
    }
  };

  const fillForm = (hub: Hub) => {
    setName(hub.name);
    setAddress(hub.address || '');
    setDescription(hub.description || '');
    setLatitude(hub.latitude === undefined || hub.latitude === null ? '' : String(hub.latitude));
    setLongitude(hub.longitude === undefined || hub.longitude === null ? '' : String(hub.longitude));
    // New location state
    if (hub.latitude != null && hub.longitude != null) {
      setLatitudeNum(Number(hub.latitude));
      setLongitudeNum(Number(hub.longitude));
      setLocMode('gps');
    } else {
      setLatitudeNum(undefined);
      setLongitudeNum(undefined);
      setLocMode('none');
    }
    setIsPublic(Boolean(hub.isPublic));
    setMedia(hub.mediaUrl || null);
    setMediaChanged(false);
  };

  const pickMedia = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Помилка', 'Потрібен дозвіл на доступ до галереї');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [16, 9],
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setMedia(result.assets[0].uri);
        setMediaChanged(true);
      }
    } catch (e) {
      console.error('Error opening gallery:', e);
      Alert.alert('Помилка', 'Не вдалося відкрити галерею');
    }
  };

  const handleDetectGPS = async () => {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Доступ відхилено',
          'GPS недоступний. Ви можете ввести координати вручну.',
          [
            { text: 'ОК' },
            { text: 'Ввести вручну', onPress: () => setLocMode('manual') },
          ],
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLatitudeNum(loc.coords.latitude);
      setLongitudeNum(loc.coords.longitude);
      setLocMode('gps');
      // Reverse geocode to fill address automatically
      try {
        const addresses = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (addresses.length > 0) {
          const a = addresses[0];
          const parts: string[] = [];
          if (a.street) parts.push(a.street);
          if (a.city) parts.push(a.city);
          if (a.region && a.region !== a.city) parts.push(a.region);
          if (a.country) parts.push(a.country);
          const full = parts.filter(Boolean).join(', ');
          if (full) setAddress(full);
        }
      } catch {
        // ignore geocode error, address field stays as is
      }
    } catch {
      Alert.alert(
        'GPS недоступний',
        'Можливо активний РЕБ або GPS вимкнено. Хочете ввести координати вручну?',
        [
          { text: 'Ні, пропустити' },
          { text: 'Ввести вручну', onPress: () => setLocMode('manual') },
        ],
      );
    } finally {
      setLocLoading(false);
    }
  };

  const handleApplyManual = () => {
    const lat = parseFloat(manualLat.replace(',', '.'));
    const lng = parseFloat(manualLng.replace(',', '.'));
    if (isNaN(lat) || lat < -90 || lat > 90) {
      Alert.alert('Помилка', 'Широта має бути від -90 до 90');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      Alert.alert('Помилка', 'Довгота має бути від -180 до 180');
      return;
    }
    setLatitudeNum(lat);
    setLongitudeNum(lng);
    setLocMode('gps');
  };

  const handleClearLocation = () => {
    setLatitudeNum(undefined);
    setLongitudeNum(undefined);
    setManualLat('');
    setManualLng('');
    setLocMode('none');
  };

  const parseCoordinate = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Помилка', 'Введіть назву хаба');
      return;
    }

    const payloadLat = latitudeNum;
    const payloadLng = longitudeNum;

    setLoading(true);
    try {
      const payload: any = {
        name: name.trim(),
        address: address.trim() || undefined,
        description: description.trim() || undefined,
        latitude: payloadLat,
        longitude: payloadLng,
        isPublic,
      };

      const savedHub = isEditing && hubId
        ? await orgsApi.updateHub(orgId, hubId, payload)
        : await orgsApi.createHub(orgId, payload);

      if (mediaChanged) {
        if (media) {
          await orgsApi.uploadHubMedia(orgId, savedHub.id, media);
        } else {
          await orgsApi.updateHub(orgId, savedHub.id, { mediaUrl: null });
        }
      }

      Alert.alert('Успіх', isEditing ? 'Хаб оновлено' : 'Хаб створено');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося зберегти хаб');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={isEditing ? 'Редагувати хаб' : 'Новий хаб'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity style={styles.mediaBox} onPress={pickMedia}>
          {media ? (
            <Image source={{ uri: getMediaUrl(media) }} style={styles.media} />
          ) : (
            <Text style={styles.mediaText}>Додати фото хаба</Text>
          )}
        </TouchableOpacity>
        {media ? (
          <Button
            title="Прибрати фото"
            variant="ghost"
            onPress={() => {
              setMedia(null);
              setMediaChanged(true);
            }}
            style={styles.removeMediaBtn}
          />
        ) : null}

        <Input label="Назва *" value={name} onChangeText={setName} />
        <Input label="Адреса" value={address} onChangeText={setAddress} />
        <Input label="Опис" value={description} onChangeText={setDescription} multiline />

        {/* ─── Геолокація ────────────────────────────────────────────────────── */}
        <Text style={styles.label}>Місцезнаходження (необов'язково)</Text>

        {locMode === 'none' && (
          <View style={styles.locOptions}>
            <TouchableOpacity
              style={styles.locOptionBtn}
              onPress={handleDetectGPS}
              disabled={locLoading}
            >
              <Text style={styles.locOptionIcon}>📡</Text>
              <Text style={styles.locOptionLabel}>
                {locLoading ? 'Визначення...' : 'GPS автоматично'}
              </Text>
              <Text style={styles.locOptionHint}>Може не працювати при РЕБ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.locOptionBtn}
              onPress={() => setLocMode('manual')}
            >
              <Text style={styles.locOptionIcon}>⌨️</Text>
              <Text style={styles.locOptionLabel}>Ввести вручну</Text>
              <Text style={styles.locOptionHint}>Координати з карти або телефону</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.locOptionBtn}
              onPress={() => navigation.navigate('SelectLocation', {
                isSelectionMode: true,
                onSelect: (coords: { latitude: number; longitude: number }) => {
                  setLatitudeNum(coords.latitude);
                  setLongitudeNum(coords.longitude);
                  setLocMode('gps');
                  // Reverse geocode to fill address automatically
                  Location.reverseGeocodeAsync({
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                  }).then((addresses) => {
                    if (addresses.length > 0) {
                      const a = addresses[0];
                      const parts: string[] = [];
                      if (a.street) parts.push(a.street);
                      if (a.city) parts.push(a.city);
                      if (a.region && a.region !== a.city) parts.push(a.region);
                      if (a.country) parts.push(a.country);
                      const full = parts.filter(Boolean).join(', ');
                      if (full) setAddress(full);
                    }
                  }).catch(() => {});
                },
              })}
            >
              <Text style={styles.locOptionIcon}>🗺</Text>
              <Text style={styles.locOptionLabel}>Вибрати на карті</Text>
              <Text style={styles.locOptionHint}>Натисніть на точку</Text>
            </TouchableOpacity>
          </View>
        )}

        {locMode === 'manual' && !(latitudeNum && longitudeNum) && (
          <View style={styles.manualBox}>
            <Text style={styles.manualTitle}>Введіть координати</Text>
            <Text style={styles.manualHint}>
              Відкрийте Google Maps, натисніть на потрібну точку — координати з'являться внизу.
            </Text>
            <View style={styles.manualRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.manualLabel}>Широта (Lat)</Text>
                <RNTextInput
                  style={styles.manualInput}
                  value={manualLat}
                  onChangeText={setManualLat}
                  placeholder="46.6354"
                  keyboardType="decimal-pad"
                  placeholderTextColor="#AAA"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.manualLabel}>Довгота (Lng)</Text>
                <RNTextInput
                  style={styles.manualInput}
                  value={manualLng}
                  onChangeText={setManualLng}
                  placeholder="32.6169"
                  keyboardType="decimal-pad"
                  placeholderTextColor="#AAA"
                />
              </View>
            </View>
            <View style={styles.manualActions}>
              <TouchableOpacity style={styles.manualCancelBtn} onPress={handleClearLocation}>
                <Text style={styles.manualCancelText}>Скасувати</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manualApplyBtn} onPress={handleApplyManual}>
                <Text style={styles.manualApplyText}>Підтвердити</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {latitudeNum != null && longitudeNum != null && (
          <View style={styles.locationBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationText}>
                📍 {Number(latitudeNum).toFixed(5)}, {Number(longitudeNum).toFixed(5)}
              </Text>
              <Text style={styles.locationHint}>
                {locMode === 'gps' ? 'GPS / Карта' : 'Введено вручну'}
              </Text>
            </View>
            <TouchableOpacity onPress={handleClearLocation} style={styles.clearLocBtn}>
              <Text style={styles.clearLocText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchTitle}>Публічний хаб</Text>
            <Text style={styles.switchHint}>Адресу видно іншим користувачам</Text>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} />
        </View>
        <Button title={isEditing ? 'Зберегти хаб' : 'Створити хаб'} onPress={handleSubmit} loading={loading} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  container: { padding: 16, paddingBottom: 32 },
  mediaBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  media: { width: '100%', height: '100%', resizeMode: 'cover' },
  mediaText: { color: Colors.textSecondary, fontWeight: '700' },
  removeMediaBtn: { marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12 },
  coordInput: { flex: 1 },

  // Поля для вибору способу локації
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  locOptions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  locOptionBtn: {
    flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 14, alignItems: 'center',
  },
  locOptionIcon: { fontSize: 24, marginBottom: 6 },
  locOptionLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  locOptionHint: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },

  // Ручне введення
  manualBox: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12,
  },
  manualTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  manualHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  manualRow: { flexDirection: 'row', gap: 10 },
  manualLabel: { fontSize: 12, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  manualInput: {
    backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.border, padding: 10, fontSize: 14, color: Colors.text,
  },
  manualActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  manualCancelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  manualCancelText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  manualApplyBtn: {
    flex: 2, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  manualApplyText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Локація задана
  locationBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#E8F5E9', borderRadius: 10, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: '#4CAF50',
  },
  locationText: { fontSize: 14, fontWeight: '600', color: '#2E7D32' },
  locationHint: { fontSize: 11, color: '#4CAF50', marginTop: 2 },
  clearLocBtn: { padding: 8 },
  clearLocText: { fontSize: 16, color: '#888' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 16,
  },
  switchText: { flex: 1, paddingRight: 12 },
  switchTitle: { color: Colors.text, fontWeight: '700' },
  switchHint: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
});