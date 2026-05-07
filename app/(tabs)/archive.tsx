import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Image } from 'expo-image';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { Tables, RemedyData } from '@/lib/types';

interface ArchivedItem {
  id: string;
  scan_id: string;
  notes: string | null;
  created_at: string;
  scan: Tables<'scans'>;
}

export default function ArchiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { removeArchivedId, setArchivedIds } = useAppStore();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchArchived = useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      const { data, error: err } = await supabase
        .from('archived_remedies')
        .select('*, scan:scans(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (err) throw err;

      const archiveItems: ArchivedItem[] = (data || []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        scan_id: d.scan_id as string,
        notes: d.notes as string | null,
        created_at: d.created_at as string,
        scan: d.scan as Tables<'scans'>,
      }));

      setItems(archiveItems);
      setArchivedIds(archiveItems.map((i) => i.scan_id));
    } catch (e: unknown) {
      console.error('Error fetching archive:', e);
      setError('Failed to load archive');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchArchived();
    setRefreshing(false);
  };

  const handleRemove = (item: ArchivedItem) => {
    Alert.alert(
      'Remove from Archive',
      `Remove ${item.scan.plant_name || 'this remedy'} from your archive?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            try {
              await supabase
                .from('archived_remedies')
                .delete()
                .eq('id', item.id)
                .eq('user_id', user.id);
              removeArchivedId(item.scan_id);
              setItems((prev) => prev.filter((i) => i.id !== item.id));
            } catch (e) {
              console.error('Error removing from archive:', e);
              Alert.alert('Error', 'Failed to remove from archive');
            }
          },
        },
      ]
    );
  };

  const getRemedySummary = (scan: Tables<'scans'>): string => {
    if (!scan.remedies) return 'No remedy data available';
    try {
      const r = scan.remedies as unknown as RemedyData;
      return r.uses || r.benefits || 'Herbal remedy archived';
    } catch {
      return 'Herbal remedy archived';
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
        }}
      >
        <Text
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 28,
            color: Colors.textPrimary,
          }}
        >
          Saved Remedies
        </Text>
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 14,
            color: Colors.textSecondary,
            marginTop: 4,
          }}
        >
          Your bookmarked herbal remedies
        </Text>
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
            onPress={fetchArchived}
            style={{
              marginTop: 16,
              paddingHorizontal: 20,
              paddingVertical: 10,
              backgroundColor: Colors.primary,
              borderRadius: 10,
            }}
          >
            <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.white }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 20,
            gap: 12,
          }}
          columnWrapperStyle={{ gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/result',
                  params: { scanId: item.scan_id },
                })
              }
              onLongPress={() => handleRemove(item)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: Colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
                overflow: 'hidden',
                opacity: pressed ? 0.9 : 1,
                boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
              })}
            >
              <View
                style={{
                  height: 120,
                  backgroundColor: Colors.background,
                }}
              >
                {item.scan.image_url ? (
                  <Image
                    source={{ uri: item.scan.image_url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="leaf" size={32} color={Colors.accentLight} />
                  </View>
                )}
                <View
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    borderRadius: 8,
                    padding: 4,
                  }}
                >
                  <Ionicons name="bookmark" size={14} color={Colors.primary} />
                </View>
              </View>
              <View style={{ padding: 12, gap: 4 }}>
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 14,
                    color: Colors.textPrimary,
                  }}
                  numberOfLines={1}
                >
                  {item.scan.plant_name || 'Unknown'}
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: Colors.textSecondary,
                    lineHeight: 16,
                  }}
                  numberOfLines={2}
                >
                  {getRemedySummary(item.scan)}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View
              style={{
                paddingVertical: 60,
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Ionicons name="bookmark-outline" size={48} color={Colors.textLight} />
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 16,
                  color: Colors.textPrimary,
                }}
              >
                No archived remedies
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 14,
                  color: Colors.textSecondary,
                  textAlign: 'center',
                  maxWidth: 280,
                }}
              >
                Archive useful remedies from your scan results to access them later
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
