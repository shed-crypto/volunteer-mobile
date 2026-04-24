import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../utils/theme';
import { useAuth } from '../context/AuthContext';
import { SystemRole } from '../types';
import { OfflineBanner } from '../components/OfflineBanner';
import { chatApi } from '../api/chat.api';

import RequestsListScreen   from '../screens/requests/RequestsListScreen';
import RequestDetailScreen  from '../screens/requests/RequestDetailScreen';
import CreateRequestScreen  from '../screens/requests/CreateRequestScreen';
import TaskDetailScreen     from '../screens/tasks/TaskDetailScreen';
import MapScreen            from '../screens/map/MapScreen';
import SelectLocationScreen from '../screens/map/SelectLocationScreen';
import ChatsListScreen      from '../screens/chat/ChatsListScreen';
import ChatRoomScreen       from '../screens/chat/ChatRoomScreen';
import ProfileScreen        from '../screens/profile/ProfileScreen';
import EditProfileScreen    from '../screens/profile/EditProfileScreen';
import VehiclesScreen       from '../screens/profile/VehiclesScreen';
import UserProfileScreen    from '../screens/profile/UserProfileScreen';
import OrganizationsScreen  from '../screens/organizations/OrganizationsScreen';
import OrgDetailScreen      from '../screens/organizations/OrgDetailScreen';
import AdminScreen          from '../screens/admin/AdminScreen';
import KanbanScreen          from '../screens/kanban/KanbanScreen';

const RequestsStack = createNativeStackNavigator();
function RequestsStackNavigator() {
  return (
    <RequestsStack.Navigator screenOptions={{ headerShown: false }}>
      <RequestsStack.Screen name="RequestsList"   component={RequestsListScreen} />
      <RequestsStack.Screen name="RequestDetail"  component={RequestDetailScreen} />
      <RequestsStack.Screen name="CreateRequest"  component={CreateRequestScreen} />
      <RequestsStack.Screen name="TaskDetail"     component={TaskDetailScreen} />
      <RequestsStack.Screen name="UserProfile"    component={UserProfileScreen} />
      <RequestsStack.Screen name="Kanban"         component={KanbanScreen} />
      <RequestsStack.Screen name="CreateTask"     component={TaskDetailScreen} />
    </RequestsStack.Navigator>
  );
}

const MapStack = createNativeStackNavigator();
function MapStackNavigator() {
  return (
    <MapStack.Navigator screenOptions={{ headerShown: false }}>
      <MapStack.Screen name="MapMain"          component={MapScreen} />
      <MapStack.Screen name="SelectLocation"   component={SelectLocationScreen} />
      <MapStack.Screen name="RequestDetail"    component={RequestDetailScreen} />
      <MapStack.Screen name="TaskDetail"       component={TaskDetailScreen} />
    </MapStack.Navigator>
  );
}

const ChatStack = createNativeStackNavigator();
function ChatStackNavigator() {
  return (
    <ChatStack.Navigator screenOptions={{ headerShown: false }}>
      <ChatStack.Screen name="ChatsList"   component={ChatsListScreen} />
      <ChatStack.Screen name="ChatRoom"    component={ChatRoomScreen} />
      <ChatStack.Screen name="UserProfile" component={UserProfileScreen} />
    </ChatStack.Navigator>
  );
}

const ProfileStack = createNativeStackNavigator();
function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain"   component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile"   component={EditProfileScreen} />
      <ProfileStack.Screen name="Vehicles"      component={VehiclesScreen} />
      <ProfileStack.Screen name="Organizations" component={OrganizationsScreen} />
      <ProfileStack.Screen name="OrgDetail"     component={OrgDetailScreen} />
      <ProfileStack.Screen name="UserProfile"   component={UserProfileScreen} />
    </ProfileStack.Navigator>
  );
}

// ─── Admin Stack — власний навігатор зі своїм стеком ──────────────────────────
// Це виправляє баг: AdminScreen.navigate('UserProfile') падало, бо UserProfile
// була зареєстрована лише в ProfileStack, а не в Admin tab.
const AdminStack = createNativeStackNavigator();
function AdminStackNavigator() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminMain" component={AdminScreen} />
      <AdminStack.Screen name="DevDBInspector" component={DevDBInspector} />
      <AdminStack.Screen name="UserProfile" component={UserProfileScreen} />
    </AdminStack.Navigator>
  );
}

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={badge.wrap}>
      <Text style={badge.text}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: '#d32f2f', borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  text: { color: '#fff', fontSize: 9, fontWeight: '700' },
});

const Tab = createBottomTabNavigator();

export default function MainNavigator() {
  const { user }            = useAuth();
  const isAdmin             = user?.systemRole === SystemRole.ADMIN;
  const [unread, setUnread] = useState(0);

  // FR-10g: badge непрочитаних повідомлень
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const chats = await chatApi.getMyChats();
        if (cancelled) return;
        const count = chats.reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0);
        setUnread(count);
      } catch { /* offline — ігноруємо */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Стан для відстеження активної вкладки
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const handleTabPress = (tabName: string, navigation: any) => {
    // Якщо користувач натискає на вже активну вкладку - скидаємо фільтри
    if (activeTab === tabName) {
      // Скидаємо фільтри для кожної вкладки
      if (tabName === 'Requests') {
        // Скидання фільтрів для заявок
        navigation.navigate('Requests', { screen: 'RequestsList' });
      } else if (tabName === 'Map') {
        // Скидання фільтрів для мапи
        navigation.navigate('Map', { screen: 'MapMain' });
      } else if (tabName === 'Chats') {
        // Скидання фільтрів для чатів
        navigation.navigate('Chats', { screen: 'ChatsList' });
      } else if (tabName === 'Profile') {
        // Скидання фільтрів для профілю
        navigation.navigate('Profile', { screen: 'ProfileMain' });
      } else if (tabName === 'Admin' && isAdmin) {
        // Скидання фільтрів для адміна
        navigation.navigate('Admin', { screen: 'AdminMain' });
      }
    }
    setActiveTab(tabName);
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tab.Navigator
        screenOptions={({ route, navigation }) => ({
          headerShown: false,
          tabBarActiveTintColor:   Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border, paddingBottom: 4, height: 60 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarIcon: ({ focused, color, size }) => {
            const icons: Record<string, [string, string]> = {
              Requests: ['list',        'list-outline'],
              Map:      ['map',         'map-outline'],
              Chats:    ['chatbubbles', 'chatbubbles-outline'],
              Profile:  ['person',      'person-outline'],
              Admin:    ['shield',      'shield-outline'],
            };
            const [active, inactive] = icons[route.name] ?? ['apps', 'apps-outline'];
            if (route.name === 'Chats') {
              return (
                <View>
                  <Ionicons name={(focused ? active : inactive) as any} size={size} color={color} />
                  <TabBadge count={unread} />
                </View>
              );
            }
            return <Ionicons name={(focused ? active : inactive) as any} size={size} color={color} />;
          },
          // Додаємо обробник натискання на вкладку
          tabBarButton: (props: any) => {
            return (
              <TouchableOpacity
                {...props}
                onPress={() => {
                  handleTabPress(route.name, navigation);
                  props.onPress();
                }}
              />
            );
          },
        })}
      >
        <Tab.Screen name="Requests" component={RequestsStackNavigator} options={{ title: 'Заявки' }} />
        <Tab.Screen name="Map"      component={MapStackNavigator}      options={{ title: 'Карта'  }} />
        <Tab.Screen name="Chats"    component={ChatStackNavigator}     options={{ title: 'Чати'   }} />
        <Tab.Screen name="Profile"  component={ProfileStackNavigator}  options={{ title: 'Профіль'}} />
        {isAdmin && <Tab.Screen name="Admin" component={AdminStackNavigator} options={{ title: 'Адмін' }} />}
      </Tab.Navigator>
    </View>
  );
}
