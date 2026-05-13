import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { ScanCard } from '@/components/scan-card';
import { useAppStore } from '@/store/useAppStore';
import { extractErrorMessage, logError } from '@/lib/error-utils';
import Animated, { FadeOut, Layout } from 'react-native-reanimated';
import type { Tables } from '@/lib/types';

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { setRecentScans } = useAppStore();
  const [scans, setScans] = useState<Tables<'scans'>[]>([]);
  const [filtered, setFiltered] = useState<Tables<'scans'>[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const fetchScans = useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      const { data, error: err } = await supabase
        .from('scans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setScans(data || []);
      setFiltered(data || []);
    } catch (e: unknown) {
      logError('[history] Error fetching scans', e);
      setError(extractErrorMessage(e, 'Failed to load scan history'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(scans);
    } else {
      const q = search.toLowerCase();
      setFiltered(
        scans.filter(
          (s) =>
            s.plant_name?.toLowerCase().includes(q) ||
            s.scientific_name?.toLowerCase().includes(q)
        )
      );
    }
  }, [search, scans]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchScans();
    setRefreshing(false);
  };

  const handleDeleteScan = (scan: Tables<'scans'>) => {
    Alert.alert(
      'Delete Scan',
      `Delete "${scan.plant_name || 'this scan'}" from your history?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteScan(scan),
        },
      ]
    );
  };

  const deleteScan = async (scan: Tables<'scans'>) => {
    if (!user?.id) return;
    setDeleting(scan.id);

    try {
      // Delete associated archived remedy if any
      await supabase
        .from('archived_remedies')
        .delete()
        .eq('scan_id', scan.id)
        .eq('user_id', user.id);

      // Delete scan image from storage if exists
      if (scan.image_url) {
        try {
          const urlParts = scan.image_url.split('/scan-images/');
          if (urlParts[1]) {
            await supabase.storage.from('scan-images').remove([urlParts[1]]);
          }
        } catch {
          // Non-blocking: image cleanup failure shouldn't prevent scan deletion
        }
      }

      // Delete the scan record
      const { error: deleteErr } = await supabase
        .from('scans')
        .delete()
        .eq('id', scan.id)
        .eq('user_id', user.id);

      if (deleteErr) throw deleteErr;

      // Update local state immediately
      setScans((prev) => prev.filter((s) => s.id !== scan.id));
      setRecentScans(scans.filter((s) => s.id !== scan.id).slice(0, 5));
    } catch (e: unknown) {
      logError('[history] Error deleting scan', e);
      Alert.alert('Error', extractErrorMessage(e, 'Failed to delete scan. Please try again.'));
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = () => {
    if (scans.length === 0) return;

    Alert.alert(
      'Clear All History',
      'Are you sure you want to delete all scan history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: clearAllScans,
        },
      ]
    );
  };

  const clearAllScans = async () => {
    if (!user?.id) return;
    setClearingAll(true);

    try {
      // Delete all archived remedies for user
      await supabase
        .from('archived_remedies')
        .delete()
        .eq('user_id', user.id);

      // Delete all scan images from storage
      try {
        const { data: files } = await supabase.storage
          .from('scan-images')
          .list(user.id);

        if (files && files.length > 0) {
          const filePaths = files.map((f) => `${user.id}/${f.name}`);
          await supabase.storage.from('scan-images').remove(filePaths);
        }
      } catch {
        // Non-blocking: image cleanup failure shouldn't prevent deletion
      }

      // Delete all scans for user
      const { error: deleteErr } = await supabase
        .from('scans')
        .delete()
        .eq('user_id', user.id);

      if (deleteErr) throw deleteErr;

      // Update local state
      setScans([]);
      setFiltered([]);
      setRecentScans([]);
    } catch (e: unknown) {
      logError('[history] Error clearing all scans', e);
      Alert.alert('Error', extractErrorMessage(e, 'Failed to clear history. Please try again.'));
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          backgroundColor: Colors.background,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.extraBold,
              fontSize: 28,
              color: Colors.textPrimary,
            }}
          >
            Snap History
          </Text>
          {scans.length > 0 && !loading && (
            <Pressable
              onPress={handleClearAll}
              disabled={clearingAll}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 10,
                borderCurve: 'continuous',
                backgroundColor: clearingAll ? 'rgba(211,47,47,0.05)' : 'rgba(211,47,47,0.08)',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {clearingAll ? (
                <ActivityIndicator size={14} color={Colors.error} />
              ) : (
                <Ionicons name="trash-outline" size={14} color={Colors.error} />
              )}
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 12,
                  color: Colors.error,
                }}
              >
                Clear All
              </Text>
            </Pressable>
          )}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: Colors.card,
            borderRadius: 14,
            borderCurve: 'continuous',
            paddingHorizontal: 14,
            gap: 8,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <Ionicons name="search" size={18} color={Colors.textLight} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search plants..."
            placeholderTextColor={Colors.textLight}
            style={{
              flex: 1,
              fontFamily: Fonts.regular,
              fontSize: 15,
              color: Colors.textPrimary,
              paddingVertical: 12,
            }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={Colors.textLight} />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 40,
          }}
        >
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text
            selectable
            style={{
              fontFamily: Fonts.semiBold,
              fontSize: 16,
              color: Colors.error,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
          <Pressable
            onPress={fetchScans}
            style={{
              marginTop: 16,
              paddingHorizontal: 20,
              paddingVertical: 10,
              backgroundColor: Colors.primary,
              borderRadius: 10,
            }}
          >
            <Text
              style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.white }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 20,
            gap: 10,
          }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
          renderItem={({ item }) => (
            <Animated.View
              exiting={FadeOut.duration(250)}
              layout={Layout.springify().damping(18).stiffness(120)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
                <View style={{ flex: 1 }}>
                  <ScanCard
                    scan={item}
                    onPress={() =>
                      router.push({
                        pathname: '/result',
                        params: { scanId: item.id },
                      })
                    }
                  />
                </View>
                <Pressable
                  onPress={() => handleDeleteScan(item)}
                  disabled={deleting === item.id}
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed
                      ? 'rgba(211,47,47,0.12)'
                      : 'rgba(211,47,47,0.06)',
                    marginLeft: 8,
                    opacity: deleting === item.id ? 0.5 : 1,
                  })}
                  accessibilityLabel={`Delete ${item.plant_name || 'scan'}`}
                  accessibilityRole="button"
                >
                  {deleting === item.id ? (
                    <ActivityIndicator size={14} color={Colors.error} />
                  ) : (
                    <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  )}
                </Pressable>
              </View>
            </Animated.View>
          )}
          ListEmptyComponent={
            <View
              style={{
                paddingVertical: 60,
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Ionicons
                name="time-outline"
                size={48}
                color={Colors.textLight}
              />
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 16,
                  color: Colors.textPrimary,
                }}
              >
                {search ? 'No matching plants' : 'No scans yet'}
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 14,
                  color: Colors.textSecondary,
                  textAlign: 'center',
                }}
              >
                {search
                  ? `No results for "${search}"`
                  : 'Your scan history will appear here'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
