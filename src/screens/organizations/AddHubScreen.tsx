import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { orgsApi } from '../../api/orgs.api';
import { Button, Input, ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';

type RouteParams = { orgId: string };

export default function AddHubScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const orgId = route.params?.orgId;

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Помилка', 'Введіть назву хабу');
      return;
    }
    setLoading(true);
    try {
      // Виправляємо payload: додаємо обов'язкові поля latitude/longitude, які очікує бекенд
      await orgsApi.createHub(orgId, { 
        name, 
        address, 
        description,
        latitude: 0, 
        longitude: 0 
      });
      Alert.alert('Успіх', 'Хаб успішно створено');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося створити хаб');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title="Новий хаб" onBack={() => navigation.goBack()} />
      <View style={styles.container}>
        <Input label="Назва *" value={name} onChangeText={setName} />
        <Input label="Адреса" value={address} onChangeText={setAddress} />
        <Input label="Опис" value={description} onChangeText={setDescription} multiline />
        <Button title="Створити хаб" onPress={handleSubmit} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
});