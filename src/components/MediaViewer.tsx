import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Colors } from '../utils/theme';

const { width, height } = Dimensions.get('window');

interface MediaViewerProps {
  visible: boolean;
  onClose: () => void;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'document';
  fileName?: string;
}

export function MediaViewer({
  visible,
  onClose,
  mediaUrl,
  mediaType,
  fileName,
}: MediaViewerProps) {
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<Video>(null);

  const handleDownload = async () => {
    try {
      if (mediaType === 'document' && fileName) {
        const localUri = `${FileSystem.cacheDirectory}${fileName}`;
        const downloadResumable = FileSystem.createDownloadResumable(
          mediaUrl,
          localUri,
          {},
          (downloadProgress) => {
            // Progress callback if needed
          }
        );
        await downloadResumable.downloadAsync();
        await Sharing.shareAsync(localUri);
      }
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const renderImage = () => (
    <View style={styles.container}>
      <Image
        source={{ uri: mediaUrl }}
        style={styles.image}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
      />
      {loading && <ActivityIndicator size="large" color={Colors.primary} style={styles.loading} />}
    </View>
  );

  const renderVideo = () => (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        style={styles.video}
        source={{ uri: mediaUrl }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        isLooping
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
      />
      {loading && <ActivityIndicator size="large" color={Colors.primary} style={styles.loading} />}
    </View>
  );

  const renderDocument = () => (
    <View style={styles.container}>
      <Text style={styles.fileName}>{fileName || 'Документ'}</Text>
      <TouchableOpacity style={styles.downloadButton} onPress={handleDownload}>
        <Text style={styles.downloadButtonText}>⬇️ Завантажити</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <View style={styles.modalContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
        {mediaType === 'image' && renderImage()}
        {mediaType === 'video' && renderVideo()}
        {mediaType === 'document' && renderDocument()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  closeButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 20,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: width * 0.8,
    height: height * 0.6,
    resizeMode: 'contain',
  },
  video: {
    width: width * 0.8,
    height: height * 0.6,
  },
  fileName: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 20,
  },
  downloadButton: {
    backgroundColor: Colors.primary,
    padding: 15,
    borderRadius: 10,
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loading: {
    position: 'absolute',
  },
});