import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { ScanCard } from '@/components/scan-card';
import type { Tables } from '@/lib/types';

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [scans, setScans] = useState<Tables<'scans'>[]>([]);
  const [filtered, setFiltered] = useState<Tables<'scans'>[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      console.error('Error fetching scans:', e);
      setError('Failed to load scan history');
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
        <Text
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 28,
            color: Colors.textPrimary,
            marginBottom: 12,
          }}
        >
          Snap History
        </Text>
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
            <ScanCard
              scan={item}
              onPress={() =>
                router.push({
                  pathname: '/result',
                  params: { scanId: item.id },
                })
              }
            />
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
