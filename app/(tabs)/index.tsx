import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { logError } from '@/lib/error-utils';
import { CreditBadge } from '@/components/credit-badge';
import { ScanCard } from '@/components/scan-card';
import Animated, { FadeInDown } from 'react-native-reanimated';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile, setProfile, recentScans, setRecentScans } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasEverPaid, setHasEverPaid] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [profileRes, scansRes, paymentsRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase
          .from('scans')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('payments')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'success')
          .limit(1),
      ]);

      if (profileRes.data) setProfile(profileRes.data);
      if (scansRes.data) setRecentScans(scansRes.data);
      setHasEverPaid((paymentsRes.data?.length ?? 0) > 0);
    } catch (e: unknown) {
      logError('[home] Error fetching home data', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const displayName =
    profile?.full_name || user?.email?.split('@')[0] || 'there';
  const firstName = displayName.split(' ')[0];
  const credits = profile?.scan_credits ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: 24,
        paddingHorizontal: 20,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(500)}>
        <Text
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 28,
            color: Colors.textPrimary,
            marginBottom: 4,
          }}
        >
          Hello, {firstName}!
        </Text>
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 14,
            color: Colors.textSecondary,
            marginBottom: 16,
          }}
        >
          What plant would you like to identify today?
        </Text>
      </Animated.View>

      {/* Credits */}
      <Animated.View entering={FadeInDown.delay(100).duration(500)}>
        <CreditBadge credits={credits} isTrial={!hasEverPaid} />
      </Animated.View>

      {/* Scan Button */}
      <Animated.View entering={FadeInDown.delay(200).duration(500)}>
        <Pressable
          onPress={() => router.push('/scan')}
          style={({ pressed }) => ({
            backgroundColor: Colors.primary,
            borderRadius: 24,
            borderCurve: 'continuous',
            paddingVertical: 28,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 20,
            gap: 10,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            boxShadow: '0 4px 16px rgba(46, 125, 50, 0.3)',
          })}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="camera" size={32} color={Colors.white} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 18,
              color: Colors.white,
            }}
          >
            Scan a Plant
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 13,
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            Take a photo or choose from gallery
          </Text>
        </Pressable>
      </Animated.View>

      {/* Recent Snaps */}
      <Animated.View
        entering={FadeInDown.delay(300).duration(500)}
        style={{ marginTop: 28 }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 18,
              color: Colors.textPrimary,
            }}
          >
            Recent Snaps
          </Text>
          {recentScans.length > 0 && (
            <Pressable onPress={() => router.push('/(tabs)/history')}>
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 13,
                  color: Colors.primary,
                }}
              >
                View All
              </Text>
            </Pressable>
          )}
        </View>

        {loading ? (
          <View
            style={{
              paddingVertical: 40,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : recentScans.length === 0 ? (
          <View
            style={{
              backgroundColor: Colors.card,
              borderRadius: 20,
              borderCurve: 'continuous',
              padding: 32,
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: 'rgba(46,125,50,0.08)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="leaf-outline" size={28} color={Colors.primary} />
            </View>
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 15,
                color: Colors.textPrimary,
              }}
            >
              No scans yet
            </Text>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: Colors.textSecondary,
                textAlign: 'center',
              }}
            >
              {'Tap "Scan a Plant" to identify your first herb'}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {recentScans.map((scan) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                variant="compact"
                onPress={() =>
                  router.push({
                    pathname: '/result',
                    params: { scanId: scan.id },
                  })
                }
              />
            ))}
          </ScrollView>
        )}
      </Animated.View>

      {/* Tips section */}
      <Animated.View
        entering={FadeInDown.delay(400).duration(500)}
        style={{ marginTop: 28 }}
      >
        <Text
          style={{
            fontFamily: Fonts.bold,
            fontSize: 18,
            color: Colors.textPrimary,
            marginBottom: 14,
          }}
        >
          Quick Tips
        </Text>
        <View style={{ gap: 10 }}>
          {[
            {
              icon: 'sunny-outline' as const,
              title: 'Good Lighting',
              desc: 'Photograph in natural daylight for best results',
            },
            {
              icon: 'scan-outline' as const,
              title: 'Focus on Leaves',
              desc: 'Clear, close-up leaf shots improve accuracy',
            },
            {
              icon: 'shield-checkmark-outline' as const,
              title: 'Verify Remedies',
              desc: 'Always consult a professional before use',
            },
          ].map((tip, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                backgroundColor: Colors.card,
                borderRadius: 16,
                borderCurve: 'continuous',
                padding: 14,
                gap: 12,
                alignItems: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  backgroundColor: 'rgba(46,125,50,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={tip.icon} size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 14,
                    color: Colors.textPrimary,
                  }}
                >
                  {tip.title}
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: Colors.textSecondary,
                  }}
                >
                  {tip.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Animated.View>
    </ScrollView>
  );
}
