/**
 * CreateRequestScreen.tsx
 *
 * БАГ-ФІКс: РЕБ / GPS не доступний.
 * Додано три способи вказати локацію:
 *   1. GPS автоматично (expo-location) — якщо доступний
 *   2. Ручне введення координат (два TextInput) — fallback при РЕБ
 *   3. Без локації — якщо не потрібна або небезпечно вказувати
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, StyleSheet, KeyboardAvoidingView, Platform,
  TextInput as RNTextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { requestsApi } from '../../api/requests.api';
import { RequestCategory, RequestUrgency, ClearanceLevel } from '../../types';
import { Colors, categoryLabels, urgencyColors, clearanceLabels } from '../../utils/theme';
import { Button, Input, ScreenHeader } from '../../components/ui';

type LocationMode = 'none' | 'gps' | 'manual';

function PickerRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.optionRow}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.option, value === o.value && styles.optionActive]}
          >
            <Text style={[styles.optionText, value === o.value && styles.optionTextActive]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function CreateRequestScreen() {
  const navigation = useNavigation<any>();

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState<RequestCategory>(RequestCategory.OTHER);
  const [urgency, setUrgency]         = useState<RequestUrgency>(RequestUrgency.MEDIUM);
  const [clearance, setClearance]     = useState<ClearanceLevel>(ClearanceLevel.LOCAL);
  const [isHidden, setIsHidden]       = useState(false);
  const [fundraisingUrl, setFundraisingUrl] = useState('');
  const [loading, setLoading]         = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});

  // Геолокація — три режими
  const [locMode, setLocMode]     = useState<LocationMode>('none');
  const [latitude, setLatitude]   = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [locLoading, setLocLoading] = useState(false);
  // Для ручного введення
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

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
      setLatitude(loc.coords.latitude);
      setLongitude(loc.coords.longitude);
      setLocMode('gps');
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
    setLatitude(lat);
    setLongitude(lng);
    setLocMode('gps'); // переходимо до режиму "координати задано"
  };

  const handleClearLocation = () => {
    setLatitude(undefined);
    setLongitude(undefined);
    setManualLat('');
    setManualLng('');
    setLocMode('none');
    setIsHidden(false);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 5) e.title = 'Назва — мін. 5 символів';
    if (fundraisingUrl && !/^https?:\/\//.test(fundraisingUrl)) {
      e.fundraisingUrl = 'Введіть повний URL (https://...)';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const req = await requestsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        urgency,
        requiredClearance: clearance,
        isLocationHidden: isHidden,
        fundraisingUrl: fundraisingUrl.trim() || undefined,
        latitude,
        longitude,
      });
      navigation.replace('RequestDetail', { requestId: req.id });
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      Alert.alert('Помилка', Array.isArray(msg) ? msg.join('\n') : (msg ?? 'Щось пішло не так'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Нова заявка" onBack={() => {
        if (navigation.canGoBack()) navigation.goBack();
      }} />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Input
          label="Назва заявки *"
          value={title}
          onChangeText={setTitle}
          placeholder="Наприклад: Потрібна евакуація родини з Херсонщини"
          multiline
          error={errors.title}
        />

        <Input
          label="Опис (необов'язково)"
          value={description}
          onChangeText={setDescription}
          placeholder="Деталі: кількість людей, стан здоров'я, контакти..."
          multiline
          style={{ minHeight: 100, textAlignVertical: 'top' }}
        />

        <PickerRow
          label="Категорія"
          value={category}
          onChange={setCategory}
          options={Object.values(RequestCategory).map((v) => ({ value: v, label: categoryLabels[v] ?? v }))}
        />

        <PickerRow
          label="Терміновість"
          value={urgency}
          onChange={setUrgency}
          options={Object.values(RequestUrgency).map((v) => ({ value: v, label: urgencyColors[v]?.label ?? v }))}
        />

        <PickerRow
          label="Мінімальний рівень допуску волонтера"
          value={clearance}
          onChange={setClearance}
          options={Object.values(ClearanceLevel).map((v) => ({ value: v, label: clearanceLabels[v] ?? v }))}
        />

        <View style={styles.hintBox}>
          <Text style={styles.hintText}>
            {clearance === ClearanceLevel.LOCAL
              ? '📍 Доступно всім верифікованим волонтерам'
              : clearance === ClearanceLevel.INTERNATIONAL
              ? '🌍 Доступно лише волонтерам з міжнародним допуском'
              : '⚔️ Доступно лише фронтовим волонтерам (3+ поручителі)'}
          </Text>
        </View>

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
          onPress={() => navigation.navigate('Map', {
            screen: 'SelectLocation',
            params: {
              isSelectionMode: true,
              onSelect: (coords: { latitude: number; longitude: number }) => {
                setLatitude(coords.latitude);
                setLongitude(coords.longitude);
                setLocMode('gps');
              }
            }
          })}
        >
          <Text style={styles.locOptionIcon}>🗺</Text>
          <Text style={styles.locOptionLabel}>Вибрати на карті</Text>
          <Text style={styles.locOptionHint}>Натисніть на точку</Text>
        </TouchableOpacity>
          </View>
        )}

        {locMode === 'manual' && !(latitude && longitude) && (
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

        {latitude && longitude && (
          <View style={styles.locationBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationText}>
                📍 {latitude.toFixed(5)}, {longitude.toFixed(5)}
              </Text>
              <Text style={styles.locationHint}>
                {locMode === 'gps' ? 'GPS' : 'Введено вручну'}
              </Text>
            </View>
            <TouchableOpacity onPress={handleClearLocation} style={styles.clearLocBtn}>
              <Text style={styles.clearLocText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {latitude && longitude && (
          <TouchableOpacity style={styles.toggleRow} onPress={() => setIsHidden(!isHidden)}>
            <View style={[styles.toggle, isHidden && styles.toggleOn]}>
              <View style={[styles.toggleThumb, isHidden && styles.toggleThumbOn]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Приховати точне місцезнаходження</Text>
              <Text style={styles.toggleDesc}>Координати будуть обфусковані (безпека)</Text>
            </View>
          </TouchableOpacity>
        )}

        <Input
          label="Посилання на збір коштів (необов'язково)"
          value={fundraisingUrl}
          onChangeText={setFundraisingUrl}
          placeholder="https://send.monobank.ua/..."
          keyboardType="url"
          autoCapitalize="none"
          error={errors.fundraisingUrl}
        />

        <Button title="Опублікувати заявку" onPress={handleCreate} loading={loading} size="lg" />
        <Button
          title="Скасувати"
          variant="ghost"
          onPress={() => { if (navigation.canGoBack()) navigation.goBack(); }}
          style={{ marginTop: 8 }}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  optionText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  optionTextActive: { color: Colors.primary },
  hintBox: { backgroundColor: Colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 16 },
  hintText: { fontSize: 13, color: Colors.primary },

  // Вибір способу локації
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

  // Toggle
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 16, padding: 14,
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
  },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: Colors.border, justifyContent: 'center', padding: 2 },
  toggleOn: { backgroundColor: Colors.primary },
  toggleThumb: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, elevation: 2,
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  toggleDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
