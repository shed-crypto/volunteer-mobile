import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, Switch
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { orgsApi } from '../../api/orgs.api';
import { Colors } from '../../utils/theme';
import { ScreenHeader, Button, Card, LoadingScreen } from '../../components/ui';
import { OrganizationSettings } from '../../types';

export default function OrganizationSettingsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { orgId } = route.params;

  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [privileges, setPrivileges] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await orgsApi.getSettings(orgId);
      const priv = await orgsApi.getMemberPrivileges(orgId);
      setSettings(data);
      setPrivileges(priv);
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося завантажити налаштування');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const toggleSetting = (key: keyof OrganizationSettings) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: !settings[key] });
  };

  const handleSave = async () => {
    if (!settings) return;

    const allowedKeys = [
      'allowPublicJoin',
      'requireJoinApproval',
      'memberInviteAllowed',
      'subgroupCreationAllowed',
      'mediaUploadAllowed',
    ];

    const payload = Object.fromEntries(
      Object.entries(settings).filter(([key]) => allowedKeys.includes(key))
    );

    setSaving(true);
    try {
      await orgsApi.updateSettings(orgId, payload);
      Alert.alert('Успіх', 'Налаштування збережено');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося зберегти налаштування');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Налаштування" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <SettingRow
            label="Дозволити публічний вступ"
            description="Організація буде доступна для пошуку та запитів"
            value={settings?.allowPublicJoin || false}
            onToggle={() => toggleSetting('allowPublicJoin')}
          />
          <SettingRow
            label="Вимагати схвалення"
            description="Лідери мають схвалювати кожен запит на вступ"
            value={settings?.requireJoinApproval || false}
            onToggle={() => toggleSetting('requireJoinApproval')}
          />
          <SettingRow
            label="Запрошення учасників"
            description="Дозволити учасникам запрошувати нових людей"
            value={settings?.memberInviteAllowed || false}
            onToggle={() => toggleSetting('memberInviteAllowed')}
          />
          <SettingRow
            label="Створення підгруп"
            description="Дозволити координаторам створювати підрозділи"
            value={settings?.subgroupCreationAllowed || false}
            onToggle={() => toggleSetting('subgroupCreationAllowed')}
          />
          <SettingRow
            label="Завантаження медіа"
            description="Дозволити завантаження фото та документів"
            value={settings?.mediaUploadAllowed || false}
            onToggle={() => toggleSetting('mediaUploadAllowed')}
          />

          <Button
            title="Зберегти"
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: 24 }}
          />
        </Card>

        <Card style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>⚠️ Небезпечні дії</Text>
          <Button 
            title="Видалити" 
            variant="danger" 
            onPress={() => Alert.alert('Видалення', 'Ви впевнені?', [
              { text: 'Ні' },
              { text: 'Так', style: 'destructive', onPress: async () => {
                try {
                  await orgsApi.delete(orgId);
                  Alert.alert('Успіх', 'Видалено');
                  navigation.navigate('Organizations');
                } catch (e) { Alert.alert('Помилка', 'Не вдалося видалити'); }
              }}
            ])} 
          />
        </Card>
      </ScrollView>
    </View>
  );
}

function SettingRow({ label, description, value, onToggle }: any) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Colors.border, true: Colors.primaryLight }}
        thumbColor={value ? Colors.primary : '#f4f3f4'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  rowLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  rowDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  dangerZone: { borderColor: Colors.danger, borderWidth: 1, marginTop: 20 },
  dangerTitle: { fontSize: 16, fontWeight: '700', color: Colors.danger, marginBottom: 12 },
});
