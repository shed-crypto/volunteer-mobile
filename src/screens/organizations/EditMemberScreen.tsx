import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { orgsApi } from '../../api/orgs.api';
import { Colors } from '../../utils/theme';
import { Button, ScreenHeader } from '../../components/ui';
import { OrgRole } from '../../types';
import { useAuth } from '../../context/AuthContext';

type RouteParams = { orgId: string; userId: string; orgName: string; currentRole: string; isDeputy?: boolean };

const ROLES: { key: OrgRole; label: string }[] = [
  { key: OrgRole.COORDINATOR, label: 'Координатор' },
  { key: OrgRole.MEMBER, label: 'Учасник' },
];

export default function EditMemberScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { orgId, userId, orgName, currentRole, isDeputy: initialDeputy } = route.params || {};
  const { user: currentUser } = useAuth();

  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<OrgRole>((currentRole as OrgRole) || OrgRole.MEMBER);
  const [isDeputy, setIsDeputy] = useState(!!initialDeputy);
  const [showLeaderModal, setShowLeaderModal] = useState(false);
  const [leaderConfirmText, setLeaderConfirmText] = useState('');

  const isSelf = userId === currentUser?.id;
  const isCurrentLeader = currentRole === OrgRole.LEADER;

  const handleSave = useCallback(async () => {
    setLoading(true);
    console.log('Saving role:', { orgId, userId, selectedRole, isDeputy });
    try {
      await orgsApi.updateMemberRole(orgId, userId, selectedRole, isDeputy);
      Alert.alert('Успіх', 'Роль оновлено');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Помилка', e?.response?.data?.message || 'Не вдалося оновити роль');
    } finally {
      setLoading(false);
    }
  }, [orgId, userId, selectedRole, isDeputy, navigation]);

  const handlePressSave = () => {
    if (selectedRole === OrgRole.LEADER) {
      setShowLeaderModal(true);
      setLeaderConfirmText('');
    } else {
      handleSave();
    }
  };

  const confirmLeadershipTransfer = () => {
    if (leaderConfirmText === orgName) {
      setShowLeaderModal(false);
      handleSave();
    } else {
      Alert.alert('Помилка', 'Назва організації не співпадає');
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Редагувати учасника" onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        {isCurrentLeader && isSelf ? (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              Ви є лідером цієї організації. Зміна власної ролі призведе до втрати лідерства.
              Використайте кнопку "Передати лідерство" нижче, щоб передати права іншому учаснику.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Оберіть нову роль:</Text>

            {/* Option to make Leader (transfer leadership) */}
            {!isCurrentLeader && (
              <TouchableOpacity
                style={[styles.roleButton, selectedRole === OrgRole.LEADER && styles.roleButtonActive]}
                onPress={() => setSelectedRole(OrgRole.LEADER)}
              >
                <Ionicons name="star-outline" size={18} color={selectedRole === OrgRole.LEADER ? Colors.primary : Colors.warning} />
                <View style={styles.roleTextWrap}>
                  <Text style={[styles.roleText, selectedRole === OrgRole.LEADER && styles.roleTextActive]}>
                    Передати лідерство
                  </Text>
                  <Text style={styles.roleHint}>Ви станете координатором, а цей учасник — лідером</Text>
                </View>
              </TouchableOpacity>
            )}

            {ROLES.map((role) => (
              <TouchableOpacity
                key={role.key}
                style={[styles.roleButton, selectedRole === role.key && styles.roleButtonActive]}
                onPress={() => setSelectedRole(role.key)}
              >
                <Text style={[styles.roleText, selectedRole === role.key && styles.roleTextActive]}>
                  {role.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Deputy toggle */}
            {selectedRole !== OrgRole.LEADER && (
              <View style={styles.deputyRow}>
                <Text style={styles.deputyLabel}>Заступник лідера</Text>
                <TouchableOpacity
                  style={[styles.toggle, isDeputy && styles.toggleActive]}
                  onPress={() => setIsDeputy(!isDeputy)}
                >
                  <View style={[styles.toggleKnob, isDeputy && styles.toggleKnobActive]} />
                </TouchableOpacity>
              </View>
            )}

            <Button
              title={selectedRole === OrgRole.LEADER ? 'Передати лідерство' : 'Зберегти'}
              onPress={handlePressSave}
              loading={loading}
              style={styles.saveButton}
            />
          </>
        )}
      </View>

      {/* Leadership transfer confirmation modal */}
      <Modal visible={showLeaderModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Підтвердження передачі лідерства</Text>
            <Text style={styles.modalDesc}>
              Ви передасте права лідера учаснику цієї організації. Ви станете координатором.
              {'\n\n'}Для підтвердження введіть назву організації:{'\n'}
              <Text style={styles.modalOrgName}>{orgName}</Text>
            </Text>
            <TextInput
              style={styles.modalInput}
              value={leaderConfirmText}
              onChangeText={setLeaderConfirmText}
              placeholder="Введіть назву організації"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowLeaderModal(false)}>
                <Text style={styles.modalCancelText}>Скасувати</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, leaderConfirmText !== orgName && styles.modalConfirmDisabled]}
                disabled={leaderConfirmText !== orgName}
                onPress={confirmLeadershipTransfer}
              >
                <Text style={styles.modalConfirmText}>Підтвердити</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

import { Ionicons } from '@expo/vector-icons';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  warningText: { color: '#856404', fontSize: 14, lineHeight: 20 },
  label: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 16 },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 10,
  },
  roleButtonActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  roleTextWrap: { flex: 1 },
  roleText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  roleTextActive: { color: Colors.primary },
  roleHint: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  deputyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    marginTop: 8,
    marginBottom: 16,
  },
  deputyLabel: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  toggle: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: Colors.borderLight, padding: 2,
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.primary },
  toggleKnob: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleKnobActive: { transform: [{ translateX: 20 }] },
  saveButton: { marginTop: 8 },
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 20,
    width: '100%', maxWidth: 400,
  },
  modalTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalDesc: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  modalOrgName: { fontWeight: '700', color: Colors.primary },
  modalInput: {
    borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8,
    padding: 12, color: Colors.text, fontSize: 16, marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  modalConfirm: {
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  modalConfirmDisabled: { opacity: 0.5 },
  modalConfirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});