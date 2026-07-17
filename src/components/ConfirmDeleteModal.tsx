import React, { useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../utils/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  targetName: string;
  title?: string;
  description?: string;
}

export const ConfirmDeleteModal: React.FC<Props> = ({ 
  visible, onClose, onConfirm, targetName, 
  title = 'Видалити?', 
  description = `Введіть "${targetName}" для підтвердження` 
}) => {
  const [text, setText] = useState('');

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.desc}>{description}</Text>
          <TextInput 
            style={styles.input} 
            value={text} 
            onChangeText={setText} 
            placeholder="Введіть назву тут..."
          />
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.button, styles.cancel]} onPress={onClose}>
              <Text>Скасувати</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.button, styles.confirm, text !== targetName && styles.disabled]} 
              onPress={onConfirm}
              disabled={text !== targetName}
            >
              <Text style={styles.confirmText}>Видалити</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  container: { backgroundColor: '#fff', padding: 20, borderRadius: 12 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  desc: { marginBottom: 15, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8 },
  cancel: { backgroundColor: '#eee' },
  confirm: { backgroundColor: Colors.danger },
  disabled: { opacity: 0.5 },
  confirmText: { color: '#fff', fontWeight: '600' }
});