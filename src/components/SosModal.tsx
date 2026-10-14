import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors } from '../utils/theme';
import { Ionicons } from '@expo/vector-icons';

interface SosModalProps {
  visible: boolean;
  onClose: () => void;
  onStandardSos: () => void;
  onEditedSos: () => void;
  timeoutSeconds?: number;
}

export default function SosModal({
  visible,
  onClose,
  onStandardSos,
  onEditedSos,
  timeoutSeconds = 30,
}: SosModalProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (visible && timeLeft > 0) {
      timer = setTimeout(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (visible && timeLeft === 0) {
      onStandardSos();
    }
    return () => clearTimeout(timer);
  }, [visible, timeLeft, onStandardSos]);

  useEffect(() => {
    if (visible) {
      setTimeLeft(timeoutSeconds);
    }
  }, [visible, timeoutSeconds]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.iconContainer}>
            <Ionicons name="warning" size={48} color="#fff" />
          </View>
          <Text style={styles.title}>SOS ПРОТОКОЛ</Text>
          <Text style={styles.description}>
            Система автоматично надішле сигнал про допомогу з вашими координатами через{' '}
            <Text style={styles.timer}>{timeLeft}</Text> секунд.
          </Text>
          <View style={styles.buttonsContainer}>
            <TouchableOpacity style={styles.standardButton} onPress={onStandardSos}>
              <Text style={styles.buttonText}>Негайно (Стандартне)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editedButton} onPress={onEditedSos}>
              <Text style={styles.buttonText}>Додати деталі (Редаговане)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Відміна</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    backgroundColor: Colors.danger,
    borderRadius: 50,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.danger,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  timer: {
    fontWeight: 'bold',
    color: Colors.danger,
    fontSize: 18,
  },
  buttonsContainer: {
    width: '100%',
    gap: 12,
  },
  standardButton: {
    backgroundColor: Colors.danger,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  editedButton: {
    backgroundColor: Colors.warning,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: Colors.border,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cancelButtonText: {
    color: Colors.text,
    fontWeight: 'bold',
    fontSize: 16,
  },
});
