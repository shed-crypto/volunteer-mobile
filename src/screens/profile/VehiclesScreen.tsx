import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Alert,
  TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { usersApi } from '../../api/users.api';
import { Vehicle, VehicleType, VehicleStatus } from '../../types';
import { Colors } from '../../utils/theme';
import { Card, Button, Input, LoadingScreen, ScreenHeader, Badge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

/**
 * VehiclesScreen — управління транспортом волонтера (FR-01g, FR-07).
 *
 * API: GET /users/:id/vehicles, POST /users/me/vehicles
 * Тип транспорту впливає на можливість взяти завдання з умовою «потрібен вантажний авто».
 */

const VEHICLE_EMOJI: Record<string, string> = {
  [VehicleType.PASSENGER]: '🚗',
  [VehicleType.VAN]:       '🚐',
  [VehicleType.PICKUP]:    '🛻',
  [VehicleType.TRUCK]:     '🚛',
  [VehicleType.ARMORED]:   '🚙',
};

const VEHICLE_LABELS: Record<string, string> = {
  [VehicleType.PASSENGER]: 'Легковий',
  [VehicleType.VAN]:       'Мікроавтобус',
  [VehicleType.PICKUP]:    'Пікап',
  [VehicleType.TRUCK]:     'Вантажний',
  [VehicleType.ARMORED]:   'Броньований',
};

export default function VehiclesScreen() {
  const navigation = useNavigation<any>();
  const { user }   = useAuth();

  const [vehicles,  setVehicles]  = useState<Vehicle[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving,    setSaving]    = useState(false);

  // Форма нового авто
  const [type,       setType]       = useState<VehicleType>(VehicleType.PASSENGER);
  const [capacityKg, setCapacityKg] = useState('');
  const [plateNum,   setPlateNum]   = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await usersApi.getVehicles(user.id);
      setVehicles(data);
    } catch {
      Alert.alert('Помилка', 'Не вдалося завантажити транспорт');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setSaving(true);
    try {
      await usersApi.addVehicle({
        type,
        capacityKg: capacityKg ? parseInt(capacityKg) : undefined,
        plateNumber: plateNum.trim() || undefined,
        status: VehicleStatus.ACTIVE,
      });
      setShowModal(false);
      setCapacityKg('');
      setPlateNum('');
      setType(VehicleType.PASSENGER);
      load();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося додати транспорт');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Мій транспорт"
        subtitle="FR-01g · Транспортні засоби"
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'add-circle',
          onPress: () => setShowModal(true),
        }}
      />

      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚗</Text>
            <Text style={styles.emptyTitle}>Транспорт не додано</Text>
            <Text style={styles.emptyDesc}>
              Додайте свій транспортний засіб, щоб отримувати завдання з вимогою авто.
            </Text>
            <Button title="Додати транспорт" onPress={() => setShowModal(true)} style={{ marginTop: 16 }} />
          </View>
        }
        renderItem={({ item: v }) => (
          <Card>
            <View style={styles.vehicleRow}>
              <Text style={styles.vehicleEmoji}>{VEHICLE_EMOJI[v.type] ?? '🚗'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleType}>{VEHICLE_LABELS[v.type] ?? v.type}</Text>
                {v.plateNumber && (
                  <Text style={styles.vehiclePlate}>{v.plateNumber}</Text>
                )}
                {v.capacityKg && (
                  <Text style={styles.vehicleMeta}>Вантажопідйомність: {v.capacityKg} кг</Text>
                )}
              </View>
              <Badge
                label={v.status === VehicleStatus.ACTIVE ? 'Активний' : 'На ремонті'}
                color={v.status === VehicleStatus.ACTIVE ? Colors.success : Colors.warning}
              />
            </View>
          </Card>
        )}
      />

      {/* ── Модальне вікно додавання ────────────────────────────────────── */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Додати транспорт</Text>

            {/* Тип авто */}
            <Text style={styles.fieldLabel}>Тип транспорту</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {Object.values(VehicleType).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typePill, type === t && styles.typePillActive]}
                    onPress={() => setType(t)}
                  >
                    <Text style={styles.typePillText}>
                      {VEHICLE_EMOJI[t]} {VEHICLE_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Input
              label="Номерний знак (необов'язково)"
              value={plateNum}
              onChangeText={setPlateNum}
              placeholder="AA 1234 BB"
              autoCapitalize="characters"
            />

            <Input
              label="Вантажопідйомність, кг (необов'язково)"
              value={capacityKg}
              onChangeText={setCapacityKg}
              placeholder="1500"
              keyboardType="numeric"
            />

            <View style={styles.modalBtns}>
              <Button
                title="Скасувати"
                variant="outline"
                onPress={() => setShowModal(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Додати"
                onPress={handleAdd}
                loading={saving}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  emptyDesc:  { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  vehicleRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleEmoji:{ fontSize: 32 },
  vehicleType: { fontSize: 15, fontWeight: '700', color: Colors.text },
  vehiclePlate:{ fontSize: 13, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  vehicleMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '700',
    color: Colors.text, marginBottom: 16,
  },
  fieldLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },

  typePill: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  typePillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  typePillText: { fontSize: 13, color: Colors.text },

  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
});
