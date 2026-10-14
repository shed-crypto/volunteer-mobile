import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ActivityIndicator, ScrollView, Modal, TextInput, FlatList, SectionList } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import MapView from 'react-native-map-clustering';
import { Marker, Callout } from 'react-native-maps';
import { usersApi } from '../../api/users.api';
import { orgsApi } from '../../api/orgs.api';
import { collections } from '../../db';
import { ScreenHeader } from '../../components/ui';
import { Colors } from '../../utils/theme';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { SystemRole } from '../../types';
import * as Location from 'expo-location';
import { formatDistance } from '../../utils/distance';

export default function VolunteerRadarScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<Record<string, { orgId?: string; nearLat?: number | string; nearLng?: number | string; nearLabel?: string }>, string>>();
  const orgId = route.params?.orgId;
  const initLat = route.params?.nearLat ? Number(route.params.nearLat) : undefined;
  const initLng = route.params?.nearLng ? Number(route.params.nearLng) : undefined;
  const initLabel = route.params?.nearLabel || 'Локація заявки';
  const { user } = useAuth();
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [orgMap, setOrgMap] = useState<Map<string, string>>(new Map());
  const superClusterRef = useRef<any>(null);

  // View mode: 'map' | 'list'
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  // Advanced Filter State
  const [selectedClearances, setSelectedClearances] = useState<string[]>([]);
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(orgId ? [orgId] : []);
  const [tempClearances, setTempClearances] = useState<string[]>([]);
  const [tempOrgIds, setTempOrgIds] = useState<string[]>(orgId ? [orgId] : []);
  
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');

  // Geo-search state
  const [geoSearch, setGeoSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<{name: string; lat: number; lng: number} | null>(
    initLat && initLng ? { name: initLabel, lat: initLat, lng: initLng } : null
  );
  const [isGeocoding, setIsGeocoding] = useState(false);

  const isAdmin = user?.systemRole === SystemRole.ADMIN;
  const isAdminOrCoord = isAdmin || user?.systemRole === SystemRole.COORDINATOR;

  useEffect(() => {
    const loadGlobalOrgs = async () => {
      try {
        const localOrgs = await collections.organizations.query().fetch();
        const map = new Map(localOrgs.map((o: any) => [o.serverId || o.id, o.name]));
        setOrgMap(map);

        if (isAdmin) {
          const data = await orgsApi.getAll();
          setOrganizations(data || []);
          const map2 = new Map((data || []).map((o: any) => [o.id, o.name]));
          setOrgMap(map2);
        } else {
          const members = await collections.organizationMembers.query().fetch();
                    const myRoles = members.filter(
            (m: any) => m.userId === user?.id && m.isActive !== false && (m.orgRole === 'leader' || m.orgRole === 'coordinator')
          );
          const myOrgIds = myRoles.map((m: any) => m.organizationId);
          if (myOrgIds.length > 0 && selectedOrgIds.length === 0) {
            setSelectedOrgIds(myOrgIds);
          }
          const loadedOrgs = myRoles.map((m: any) => ({
            id: m.organizationId,
            name: map.get(m.organizationId) || 'Організація',
          }));
          setOrganizations(loadedOrgs);
        }
      } catch (e) {
        console.error('Failed to load organizations:', e);
      }
    };
    loadGlobalOrgs();
  }, [user]);

  useEffect(() => {
    loadRadar();
  }, [selectedClearances, selectedOrgIds, selectedLocation]);

  const loadRadar = async () => {
    if (!isAdmin && selectedOrgIds.length === 0) {
      // Don't fire until we have at least one orgId for coordinators
      return;
    }
    setLoading(true);
    try {
      const clearanceParam = selectedClearances.length > 0 ? selectedClearances.join(',') : undefined;
      const orgParam = selectedOrgIds.length > 0 ? selectedOrgIds.join(',') : undefined;

      const data = await usersApi.getRadar({
        organizationId: orgParam,
        clearance: clearanceParam,
        nearLat: selectedLocation?.lat,
        nearLng: selectedLocation?.lng,
        limit: selectedLocation ? 50 : undefined,
      });
      setVolunteers(data || []);
    } catch (e) {
      console.error('Failed to load radar:', e);
    } finally {
      setLoading(false);
    }
  };

  const performGeoSearch = async () => {
    if (!geoSearch.trim()) {
      setSelectedLocation(null);
      return;
    }
    setIsGeocoding(true);
    try {
      const geocodedRegions = await Location.geocodeAsync(geoSearch);
      if (geocodedRegions.length > 0) {
        const { latitude, longitude } = geocodedRegions[0];
        // Try to get a nice name for the found location
        const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
        let locationName = geoSearch;
        if (addresses.length > 0) {
           const addr = addresses[0];
           locationName = [addr.city || addr.name, addr.region].filter(Boolean).join(', ');
        }
        setSelectedLocation({ name: locationName, lat: latitude, lng: longitude });
      } else {
        alert('Локацію не знайдено');
      }
    } catch (error) {
      console.error('Geocode error:', error);
      alert('Помилка пошуку локації');
    } finally {
      setIsGeocoding(false);
    }
  };

  const clearances = [
    { label: 'Локальний (Local)', value: 'local' },
    { label: 'Міжнародний (International)', value: 'international' },
    { label: 'Фронтовий (Frontline)', value: 'frontline' },
  ];

  const handleOpenFilters = () => {
    setTempClearances([...selectedClearances]);
    setTempOrgIds([...selectedOrgIds]);
    setFilterSearchQuery('');
    setShowFiltersModal(true);
  };

  const handleApplyFilters = () => {
    setSelectedClearances([...tempClearances]);
    setSelectedOrgIds([...tempOrgIds]);
    setShowFiltersModal(false);
  };

  const handleClearFilters = () => {
    setTempClearances([]);
    setTempOrgIds(orgId ? [orgId] : []);
  };

  const toggleClearance = (value: string) => {
    if (tempClearances.includes(value)) {
      setTempClearances(tempClearances.filter(c => c !== value));
    } else {
      setTempClearances([...tempClearances, value]);
    }
  };

  const toggleOrg = (id: string) => {
    if (tempOrgIds.includes(id)) {
      setTempOrgIds(tempOrgIds.filter(o => o !== id));
    } else {
      setTempOrgIds([...tempOrgIds, id]);
    }
  };

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(filterSearchQuery.toLowerCase())
  );

  const handleClearLocation = () => {
    setSelectedLocation(null);
    setGeoSearch('');
  };

  const getClearanceColor = (clearanceLevel?: string) => {
    switch (clearanceLevel) {
      case 'frontline': return Colors.danger;
      case 'international': return Colors.primary;
      case 'local':
      default: return Colors.success;
    }
  };

  const getClearanceLabel = (clearanceLevel?: string) => {
    switch (clearanceLevel) {
      case 'frontline': return '⚔️ Фронтовий';
      case 'international': return '🌍 Міжнародний';
      case 'local': return '📍 Локальний';
      default: return 'Невідомо';
    }
  };

  const renderCluster = (cluster: any) => {
    const { id, geometry, onPress } = cluster;
    let localCount = 0;
    let internationalCount = 0;
    let frontlineCount = 0;

          const superCluster = superClusterRef.current;
    if (superCluster && id) {
      try {
        const leaves = superCluster.getLeaves(id, Infinity);
        leaves.forEach((leaf: any) => {
          // In some versions properties might not be mapped correctly without extra config
          const cLevel = leaf.properties?.clearanceLevel;
          if (cLevel === 'local') localCount++;
          else if (cLevel === 'international') internationalCount++;
          else if (cLevel === 'frontline') frontlineCount++;
        });
      } catch (e) {
        console.error('Failed to get cluster leaves:', e);
      }
    }

    const pointCount = cluster.properties?.point_count || 0;
    const isUnmapped = localCount === 0 && internationalCount === 0 && frontlineCount === 0;

    return (
      <Marker
        key={`cluster-${id}`}
        coordinate={{
          longitude: geometry.coordinates[0],
          latitude: geometry.coordinates[1],
        }}
        onPress={onPress}
      >
        <View style={styles.clusterBadge}>
          {isUnmapped ? (
            <View style={[styles.clusterSubBadge, { backgroundColor: Colors.border }]}>
              <Text style={[styles.clusterSubBadgeText, { color: Colors.text }]}>{pointCount}</Text>
            </View>
          ) : (
            <>
              {localCount > 0 && (
                <View style={[styles.clusterSubBadge, { backgroundColor: Colors.successLight }]}>
                  <Text style={[styles.clusterSubBadgeText, { color: Colors.success }]}>{localCount}</Text>
                </View>
              )}
              {internationalCount > 0 && (
                <View style={[styles.clusterSubBadge, { backgroundColor: Colors.primaryLight }]}>
                  <Text style={[styles.clusterSubBadgeText, { color: Colors.primary }]}>{internationalCount}</Text>
                </View>
              )}
              {frontlineCount > 0 && (
                <View style={[styles.clusterSubBadge, { backgroundColor: Colors.dangerLight }]}>
                  <Text style={[styles.clusterSubBadgeText, { color: Colors.danger }]}>{frontlineCount}</Text>
                </View>
              )}
            </>
          )}
        </View>
      </Marker>
    );
  };

  // ─── Render Volunteer List Item ───────────────────────────────────────────
  const renderOrgNames = (orgIds?: string[]) => {
    if (!orgIds || orgIds.length === 0) return null;
    const names = orgIds.map(id => orgMap.get(id)).filter(Boolean);
    if (names.length === 0) return null;
    return <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 4 }}>Організації: {names.join(', ')}</Text>;
  };

  const renderVolunteerItem = ({ item: v }: { item: any }) => {
    const markerColor = getClearanceColor(v.clearanceLevel);
    return (
      <TouchableOpacity 
        style={styles.listItem} 
        onPress={() => navigation.navigate('UserProfile', { userId: v.id } as never)} 
        activeOpacity={0.7}
      >
        <View style={[styles.listItemAvatar, { borderColor: markerColor }]}>
          <Ionicons name="person-circle" size={32} color={markerColor} />
        </View>
        <View style={styles.listItemInfo}>
          <Text style={styles.listItemName}>{v.fullName || 'Волонтер'}</Text>
          {renderOrgNames(v.organizationIds)}
          <Text style={styles.listItemClearance}>{getClearanceLabel(v.clearanceLevel)}</Text>
          {v.lastCheckinAt && (
            <Text style={styles.listItemDate}>
              Останній чекін: {new Date(v.lastCheckinAt).toLocaleDateString('uk-UA')}
            </Text>
          )}
        </View>
        {v.distanceKm != null && (
          <View style={styles.listItemDistance}>
            <Ionicons name="navigate-outline" size={16} color={Colors.primary} />
            <Text style={styles.listItemDistanceText}>{formatDistance(v.distanceKm)}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };


  const sectionedVolunteers = useMemo(() => {
    if (!selectedLocation || volunteers.length === 0) {
      return [{ title: 'Всі волонтери', data: volunteers }];
    }
    const near: any[] = [];
    const mid: any[] = [];
    const far: any[] = [];
    const unknown: any[] = [];

    volunteers.forEach(v => {
      if (v.distanceKm == null) unknown.push(v);
      else if (v.distanceKm <= 5) near.push(v);
      else if (v.distanceKm <= 15) mid.push(v);
      else far.push(v);
    });

    const sections = [];
    if (near.length > 0) sections.push({ title: '📍 Найближчі (до 5 км)', data: near });
    if (mid.length > 0) sections.push({ title: '🚗 Середня відстань (5-15 км)', data: mid });
    if (far.length > 0) sections.push({ title: '🗺️ Дальні (більше 15 км)', data: far });
    if (unknown.length > 0) sections.push({ title: '❓ Відстань невідома', data: unknown });
    
    return sections;
  }, [volunteers, selectedLocation]);

  const activeFilterCount = selectedClearances.length + (isAdmin ? selectedOrgIds.length : Math.max(0, selectedOrgIds.length - 1));


  return (
    <View style={styles.container}>
      <ScreenHeader 
        title="Радар волонтерів" 
        onBack={() => navigation.goBack()} 
        rightAction={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* View mode toggle */}
            <TouchableOpacity 
              onPress={() => setViewMode(viewMode === 'map' ? 'list' : 'map')} 
              style={styles.headerBtn}
            >
              <Ionicons name={viewMode === 'map' ? 'list' : 'map'} size={20} color="#fff" />
            </TouchableOpacity>
            {/* Filter button */}
            <TouchableOpacity onPress={handleOpenFilters} style={styles.headerBtn}>
              <Ionicons name="funnel" size={20} color="#fff" />
              {activeFilterCount > 0 && <View style={styles.filterBadgeCount} />}
            </TouchableOpacity>
          </View>
        }
      />

      {/* Geo-search bar */}
      <View style={styles.geoSearchContainer}>
        <Ionicons name="search" size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.geoSearchInput}
          placeholder="Пошук за містом або регіоном..."
          placeholderTextColor={Colors.textMuted}
          value={geoSearch}
          onChangeText={setGeoSearch}
          onSubmitEditing={performGeoSearch}
          returnKeyType="search"
        />
        {isGeocoding && (
          <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
        )}
        {selectedLocation ? (
          <TouchableOpacity onPress={handleClearLocation} style={{ padding: 4 }}>
            <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={performGeoSearch} style={{ padding: 4 }}>
            <Ionicons name="arrow-forward-circle" size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Active search indicator */}
      {selectedLocation && (
        <View style={styles.searchActiveBar}>
          <Ionicons name="location" size={14} color={Colors.primary} />
          <Text style={styles.searchActiveText}>
            Пошук біля: {selectedLocation.name} • {volunteers.length} волонтерів знайдено
          </Text>
          {volunteers.length === 0 && !loading && (
            <Text style={styles.searchNoResults}>
              Найближчих волонтерів не знайдено. Спробуйте змінити фільтри.
            </Text>
          )}
        </View>
      )}

      {/* MAP VIEW */}
      {viewMode === 'map' && (
        <View style={styles.mapContainer}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={{ marginTop: 8, color: Colors.text }}>Завантаження локацій...</Text>
            </View>
          )}
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: selectedLocation?.lat || 49.0,
              longitude: selectedLocation?.lng || 31.0,
              latitudeDelta: selectedLocation ? 2.0 : 10.0,
              longitudeDelta: selectedLocation ? 2.0 : 10.0,
            }}
            clusterColor={Colors.primary}
            renderCluster={renderCluster}
            animationEnabled={false}
            maxZoomLevel={16}
            superClusterRef={superClusterRef}
          >
            {volunteers.map((v) => {
              if (!v.latitude || !v.longitude) return null;
              const markerColor = getClearanceColor(v.clearanceLevel);
              return (
                  <Marker
                    key={v.id}
                    // @ts-expect-error custom prop for supercluster leaves
                    clearanceLevel={v.clearanceLevel}
                    coordinate={{ latitude: Number(v.latitude), longitude: Number(v.longitude) }}
                  >
                  <View style={[styles.markerPoint, { borderColor: markerColor }]}>
                    <Ionicons name="person-circle" size={24} color={markerColor} />
                  </View>
                  <Callout tooltip onPress={() => navigation.navigate('UserProfile', { userId: v.id } as never)}>
                    <View style={styles.calloutContainer}>
                      <Text style={styles.calloutTitle}>{v.fullName || 'Волонтер'}</Text>
                      {renderOrgNames(v.organizationIds)}
                      <Text style={styles.calloutDesc}>{getClearanceLabel(v.clearanceLevel)}{v.distanceKm != null ? ` • ${formatDistance(v.distanceKm)}` : ''}</Text>
                      <Text style={styles.calloutAction}>Перейти на профіль →</Text>
                    </View>
                  </Callout>
                </Marker>
              );
            })}
            {selectedLocation && (
              <Marker
                coordinate={{ latitude: selectedLocation.lat, longitude: selectedLocation.lng }}
                title={selectedLocation.name}
                pinColor={Colors.warning}
              />
            )}
          </MapView>
        </View>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <View style={styles.listContainer}>
          {loading ? (
            <View style={styles.listLoading}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={{ marginTop: 8, color: Colors.text }}>Завантаження...</Text>
            </View>
          ) : volunteers.length === 0 ? (
            <View style={styles.listEmpty}>
              <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.listEmptyText}>Волонтерів не знайдено</Text>
              <Text style={styles.listEmptyHint}>Спробуйте змінити фільтри або пошук</Text>
            </View>
          ) : (
            <SectionList
              sections={sectionedVolunteers}
              keyExtractor={(v) => v.id}
              renderItem={renderVolunteerItem}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{title}</Text>
                </View>
              )}
              contentContainerStyle={{ paddingBottom: 20 }}
              ListHeaderComponent={
                <View style={styles.listHeader}>
                  <Text style={styles.listHeaderText}>
                    {selectedLocation
                      ? `Найближчі до ${selectedLocation.name} (${volunteers.length})`
                      : `Всього волонтерів: ${volunteers.length}`
                    }
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}
      
      {!isAdminOrCoord && (
        <View style={styles.warningBox}>
          <Ionicons name="warning" size={20} color={Colors.warning} />
          <Text style={styles.warningText}>
            Радар показує волонтерів лише з вашої організації.
          </Text>
        </View>
      )}

      {/* FILTER MODAL */}
      <Modal
        visible={showFiltersModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFiltersModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Фільтрація волонтерів</Text>
              <TouchableOpacity onPress={() => setShowFiltersModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalSectionTitle}>Рівень доступу</Text>
              {clearances.map(c => {
                const isSelected = tempClearances.includes(c.value);
                return (
                  <TouchableOpacity 
                    key={c.value} 
                    style={styles.modalRow}
                    onPress={() => toggleClearance(c.value)}
                  >
                    <Ionicons 
                      name={isSelected ? "checkbox" : "square-outline"} 
                      size={22} 
                      color={isSelected ? Colors.primary : Colors.textMuted} 
                    />
                    <Text style={[styles.modalRowText, isSelected && styles.modalRowTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {isAdmin && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.modalSectionTitle}>Організації</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Пошук організації за назвою..."
                    placeholderTextColor={Colors.textMuted}
                    value={filterSearchQuery}
                    onChangeText={setFilterSearchQuery}
                  />

                  <ScrollView style={styles.orgsListScroll} nestedScrollEnabled={true}>
                    {filteredOrgs.length === 0 ? (
                      <Text style={styles.noOrgsText}>Організацій не знайдено</Text>
                    ) : (
                      filteredOrgs.map(org => {
                        const isSelected = tempOrgIds.includes(org.id);
                        return (
                          <TouchableOpacity 
                            key={org.id} 
                            style={styles.modalRow}
                            onPress={() => toggleOrg(org.id)}
                          >
                            <Ionicons 
                              name={isSelected ? "checkbox" : "square-outline"} 
                              size={22} 
                              color={isSelected ? Colors.primary : Colors.textMuted} 
                            />
                            <Text style={[styles.modalRowText, isSelected && styles.modalRowTextActive]}>
                              🏢 {org.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.clearBtn} onPress={handleClearFilters}>
                <Text style={styles.clearBtnText}>Очистити все</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={handleApplyFilters}>
                <Text style={styles.applyBtnText}>Застосувати</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    backgroundColor: Colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    marginTop: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },

  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  // ─── Header buttons ──────────────────
  headerBtn: {
    padding: 8,
    position: 'relative',
  },
  filterBadgeCount: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  // ─── Geo-search ──────────────────────
  geoSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  geoSearchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 6,
  },
  suggestionsContainer: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    maxHeight: 220,
    zIndex: 100,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 8,
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  suggestionRegion: {
    fontSize: 13,
    color: Colors.textMuted,
    marginLeft: 'auto',
  },
  searchActiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Colors.primaryLight,
    gap: 6,
    flexWrap: 'wrap',
  },
  searchActiveText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  searchNoResults: {
    fontSize: 12,
    color: Colors.danger,
    width: '100%',
    marginTop: 4,
  },
  // ─── Map ─────────────────────────────
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    width: Dimensions.get('window').width,
    height: '100%',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  // ─── List view ───────────────────────
  listContainer: {
    flex: 1,
  },
  listLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  listEmptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 12,
  },
  listEmptyHint: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  listHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  listHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  listItemAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    marginRight: 12,
  },
  listItemInfo: {
    flex: 1,
  },
  listItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  listItemClearance: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  listItemDate: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  listItemDistance: {
    alignItems: 'center',
    paddingLeft: 8,
  },
  listItemDistanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 2,
  },
  // ─── Clusters ────────────────────────
  clusterBadge: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 4,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  clusterSubBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clusterSubBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  markerPoint: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  // ─── Warning ─────────────────────────
  warningBox: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: Colors.warningLight,
    borderTopWidth: 1,
    borderTopColor: Colors.warning,
    alignItems: 'center',
  },
  warningText: {
    marginLeft: 8,
    color: Colors.text,
    fontSize: 13,
    flex: 1,
  },
  // ─── Modal ───────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
  },
  modalScroll: {
    marginBottom: 20,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalRowText: {
    fontSize: 15,
    marginLeft: 12,
    color: Colors.text,
  },
  modalRowTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  searchInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.text,
    marginBottom: 12,
    marginTop: 4,
  },
  orgsListScroll: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  noOrgsText: {
    textAlign: 'center',
    color: Colors.textMuted,
    paddingVertical: 20,
    fontSize: 14,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  clearBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  clearBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  applyBtn: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  calloutContainer: {
    width: 200,
    padding: 10,
    backgroundColor: Colors.surface,
    borderRadius: 8,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  calloutDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  calloutAction: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
});


