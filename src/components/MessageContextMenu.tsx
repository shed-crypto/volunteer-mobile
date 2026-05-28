import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

interface MessageContextMenuProps {
  visible: boolean;
  onClose: () => void;
  onReply?: () => void;
  onForward?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  showDownload?: boolean;
}

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  visible, onClose, onReply, onForward, onCopy, onDelete, onDownload, showDownload
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
          {onReply && (
            <TouchableOpacity style={styles.menuItem} onPress={onReply}>
              <Text style={styles.menuItemText}>Відповісти</Text>
            </TouchableOpacity>
          )}
          {onForward && (
            <TouchableOpacity style={styles.menuItem} onPress={onForward}>
              <Text style={styles.menuItemText}>Переслати</Text>
            </TouchableOpacity>
          )}
          {onCopy && (
            <TouchableOpacity style={styles.menuItem} onPress={onCopy}>
              <Text style={styles.menuItemText}>Копіювати</Text>
            </TouchableOpacity>
          )}
          {showDownload && onDownload && (
            <TouchableOpacity style={styles.menuItem} onPress={onDownload}>
              <Text style={styles.menuItemText}>Завантажити</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity style={styles.menuItem} onPress={onDelete}>
              <Text style={[styles.menuItemText, styles.deleteText]}>Видалити</Text>
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
  deleteText: {
    color: Colors.error,
  },
});