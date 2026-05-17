import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

interface ChatContextMenuProps {
  visible: boolean;
  onClose: () => void;
  isPinned: boolean;
  onPin: () => void;
  /** На майбутнє */
  onMute?: () => void;
  onSettings?: () => void;
}

export const ChatContextMenu: React.FC<ChatContextMenuProps> = ({
  visible, onClose, isPinned, onPin, onMute, onSettings,
}) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.menuContainer}>
          <TouchableOpacity style={styles.menuItem} onPress={() => { onPin(); onClose(); }}>
            <Text style={styles.menuItemText}>
              {isPinned ? '📌 Відкріпити' : '📌 Закріпити'}
            </Text>
          </TouchableOpacity>

          {onMute && (
            <TouchableOpacity style={styles.menuItem} onPress={() => { onMute(); onClose(); }}>
              <Text style={styles.menuItemText}>🔕 Вимкнути звук</Text>
            </TouchableOpacity>
          )}

          {onSettings && (
            <TouchableOpacity style={styles.menuItem} onPress={() => { onSettings(); onClose(); }}>
              <Text style={styles.menuItemText}>⚙️ Налаштування</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    backgroundColor: Colors.surface,
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  menuItem: {
    width: '100%',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 18,
    color: Colors.text,
  },
});