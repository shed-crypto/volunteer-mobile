import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Image, ScrollView, Switch, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { orgsApi } from '../../api/orgs.api';
import { Button, Input, ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { getMediaUrl } from '../../utils/fileUtils';
import { Hub } from '../../types';

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

    const lat = parseCoordinate(latitude);
    const lng = parseCoordinate(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      Alert.alert('Помилка', 'Координати мають бути числами');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || undefined,
        description: description.trim() || undefined,
        latitude: lat,
        longitude: lng,
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
        <View style={styles.row}>
          <Input label="Широта" value={latitude} onChangeText={setLatitude} keyboardType="decimal-pad" containerStyle={styles.coordInput} />
          <Input label="Довгота" value={longitude} onChangeText={setLongitude} keyboardType="decimal-pad" containerStyle={styles.coordInput} />
        </View>
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
