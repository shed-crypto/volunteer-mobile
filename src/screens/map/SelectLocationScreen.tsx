/**
 * SelectLocationScreen.tsx
 *
 * Екран для вибору точки на карті.
 */
import React, { useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenHeader, Button } from '../../components/ui';
import { Colors } from '../../utils/theme';

const DEFAULT_REGION: Region = {
  latitude: 50.4501,
  longitude: 30.5234,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

export default function SelectLocationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [selectedCoords, setSelectedCoords] = useState<{ latitude: number; longitude: number } | null>(
    route.params?.initialCoords ?? null
  );
  
  const handleConfirm = () => {
    if (selectedCoords) {
      route.params?.onSelect(selectedCoords);
      navigation.goBack();
    }
  };

  const isSelectionMode = route.params?.isSelectionMode ?? true;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Виберіть точку" onBack={() => navigation.goBack()} />
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={route.params?.initialCoords ?? DEFAULT_REGION}
        onPress={(e) => isSelectionMode && setSelectedCoords(e.nativeEvent.coordinate)}
      >
        {selectedCoords && <Marker coordinate={selectedCoords} />}
      </MapView>

      {isSelectionMode && (
        <View style={styles.footer}>
          <Button 
            title={selectedCoords ? "Підтвердити вибране" : "Натисніть на карту"} 
            onPress={handleConfirm} 
            disabled={!selectedCoords}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  footer: { padding: 16, backgroundColor: '#fff' },
});
