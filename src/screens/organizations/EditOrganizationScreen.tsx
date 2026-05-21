import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert, ScrollView, Image, TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { orgsApi } from '../../api/orgs.api';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Button, Card, LoadingScreen } from '../../components/ui';
import { getMediaUrl } from '../../utils/fileUtils';

export default function EditOrganizationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { orgId, parentOrgId } = route.params ?? {};

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerChanged, setBannerChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOrg();
  }, []);

  const loadOrg = async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    try {
      const org = await orgsApi.getOne(orgId);
      setName(org.name);
      setDescription(org.description || '');
      setTags(org.tags || []);
      setLogo(org.logoUrl || null);
      setLogoChanged(false);
      setBanner(org.bannerUrl || null);
      setBannerChanged(false);
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося завантажити дані організації');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Помилка', 'Потрібен дозвіл на доступ до галереї');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setLogo(result.assets[0].uri);
        setLogoChanged(true);
      }
    } catch (e) {
      console.error('Error opening gallery:', e);
      Alert.alert('Помилка', 'Не вдалося відкрити галерею');
    }
  };

  const pickBanner = async () => {
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
        setBanner(result.assets[0].uri);
        setBannerChanged(true);
      }
    } catch (e) {
      console.error('Error opening gallery:', e);
      Alert.alert('Помилка', 'Не вдалося відкрити галерею');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Помилка', 'Назва не може бути порожньою');
      return;
    }

    setSaving(true);
    try {
      const priv = orgId ? await orgsApi.getMemberPrivileges(orgId) : null;
      if (orgId && !priv?.canEdit && user?.systemRole !== 'admin') {
        throw new Error('Недостатньо прав для редагування');
      }

      let currentOrgId = orgId;
      if (!orgId) {
        const newOrg = await orgsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          parentOrgId,
        });
        currentOrgId = newOrg.id;
      } else {
        await orgsApi.update(orgId, {
          name: name.trim(),
          description: description.trim() || undefined,
          logoUrl: logo === null && logoChanged ? null : undefined,
          bannerUrl: banner === null && bannerChanged ? null : undefined,
        });
      }

      if (currentOrgId && logo && logoChanged) {
        await orgsApi.uploadLogo(currentOrgId, logo);
      }
      if (currentOrgId && banner && bannerChanged) {
        await orgsApi.uploadBanner(currentOrgId, banner);
      }

      Alert.alert('Успіх', orgId ? 'Організацію оновлено' : 'Організацію створено');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося зберегти зміни');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader title={orgId ? 'Редагування' : 'Нова організація'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.label}>Логотип</Text>
          <TouchableOpacity onPress={pickLogo} style={styles.logoPicker}>
            {logo ? (
              <Image source={{ uri: getMediaUrl(logo) }} style={styles.logo} />
            ) : (
              <Text style={styles.logoText}>Додати логотип</Text>
            )}
          </TouchableOpacity>

          {logo ? (
            <Button
              title="Прибрати логотип"
              variant="ghost"
              onPress={() => {
                setLogo(null);
                setLogoChanged(true);
              }}
              style={styles.removeLogoBtn}
            />
          ) : null}

          <Text style={styles.label}>Банер</Text>
          <TouchableOpacity onPress={pickBanner} style={styles.bannerPicker}>
            {banner ? (
              <Image source={{ uri: getMediaUrl(banner) }} style={styles.banner} />
            ) : (
              <Text style={styles.logoText}>Додати банер</Text>
            )}
          </TouchableOpacity>

          {banner ? (
            <Button
              title="Прибрати банер"
              variant="ghost"
              onPress={() => {
                setBanner(null);
                setBannerChanged(true);
              }}
              style={styles.removeLogoBtn}
            />
          ) : null}

          <Text style={styles.label}>Назва організації *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Введіть назву"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.label}>Опис</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Введіть опис"
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={4}
          />

          <Button
            title="Зберегти зміни"
            onPress={handleSave}
            loading={saving}
            style={styles.saveBtn}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8, marginTop: 12 },
  logoPicker: { 
    width: 120,
    height: 120, 
    alignSelf: 'center',
    backgroundColor: '#f0f0f0', 
    borderRadius: 10, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginBottom: 12,
    overflow: 'hidden',
  },
  logo: { 
    width: '100%', 
    height: '100%', 
    borderRadius: 10,
    resizeMode: 'cover',
  },
  bannerPicker: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  banner: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    resizeMode: 'cover',
  },
  logoText: { color: Colors.textSecondary, fontWeight: '600' },
  removeLogoBtn: { marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: '#fff',
  },
  textArea: { height: 120, textAlignVertical: 'top' },
  saveBtn: { marginTop: 24 },
});
