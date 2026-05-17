import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token: string };
  VerifyResetCode: { email: string };
  CreateNewPassword: { token: string };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="ForgotPassword" component={require('../screens/auth/ForgotPasswordScreen').default} />
      <Stack.Screen name="VerifyResetCode" component={require('../screens/auth/VerifyResetCodeScreen').default} />
      <Stack.Screen name="CreateNewPassword" component={require('../screens/auth/CreateNewPasswordScreen').default} />
      <Stack.Screen name="ResetPassword" component={require('../screens/auth/ResetPasswordScreen').default} />
    </Stack.Navigator>
  );
}
