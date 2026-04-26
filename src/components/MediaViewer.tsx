import React from 'react';
import { Modal, View, Image, TouchableOpacity, StyleSheet, Text } from 'react-native';

interface MediaViewerProps {
  visible: boolean;
  url: string;
  onClose: () => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ visible, url, onClose }) => {
  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '80%' },
  closeBtn: { position: 'absolute', top: 50, right: 20, zIndex: 1, padding: 10 },
  closeText: { color: '#fff', fontSize: 30 },
});
