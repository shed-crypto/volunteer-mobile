import * as Location from 'expo-location';
import { Alert } from 'react-native';

export interface LocationData {
  latitude: number;
  longitude: number;
}

export const locationHelper = {
  async getCurrentLocation(showErrorAlert: boolean = true): Promise<LocationData | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (showErrorAlert) {
          Alert.alert(
            'Немає доступу до геолокації',
            'Для цієї дії потрібно надати дозвіл на використання вашого місцезнаходження.'
          );
        }
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (err) {
      console.error('Failed to get location:', err);
      if (showErrorAlert) {
        Alert.alert(
          'Помилка геолокації',
          'Не вдалося отримати поточне місцезнаходження. Перевірте підключення до мережі та GPS.'
        );
      }
      return null;
    }
  },
};
