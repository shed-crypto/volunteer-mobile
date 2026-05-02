import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert, ScrollView
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { orgsApi } from '../../api/orgs.api';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Button, Card, LoadingScreen } from '../../components/ui';

export default function EditOrganizationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { orgId, parentOrgId } = route.params;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося завантажити дані організації');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Помилка', 'Назва не може бути порожньою');
      return;
    }

    setSaving(true);
    try {
      if (orgId) {
        await orgsApi.update(orgId, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        Alert.alert('Успіх', 'Організацію оновлено');
      } else {
        await orgsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          parentOrgId: parentOrgId,
        });
        Alert.alert('Успіх', 'Підгрупу створено');
      }
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
      <ScreenHeader title="Редагування" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
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