import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@fastshot/auth';
import { useEffect } from 'react';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

export default function SplashOnboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: Colors.primaryDark,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      {/* Decorative background circles */}
      <View
        style={{
          position: 'absolute',
          top: -80,
          right: -60,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: 'rgba(139, 195, 74, 0.08)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 120,
          left: -100,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: 'rgba(139, 195, 74, 0.06)',
        }}
      />

      <View style={{ flex: 1 }} />

      {/* Logo section */}
      <Animated.View
        entering={FadeIn.duration(800)}
        style={{ alignItems: 'center', gap: 16 }}
      >
        <View
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: 'rgba(255,255,255,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="leaf" size={48} color={Colors.accent} />
          </View>
        </View>

        <Animated.Text
          entering={FadeInDown.delay(200).duration(600)}
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 38,
            color: Colors.white,
            letterSpacing: -1,
          }}
        >
          HerbScan
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.delay(400).duration(600)}
          style={{
            fontFamily: Fonts.regular,
            fontSize: 16,
            color: 'rgba(255,255,255,0.7)',
            textAlign: 'center',
            lineHeight: 24,
          }}
        >
          {"Identify plants."}{'\n'}{"Discover nature's medicine."}
        </Animated.Text>
      </Animated.View>

      <View style={{ flex: 1 }} />

      {/* Decorative leaves */}
      <Animated.View
        entering={FadeInDown.delay(500).duration(700)}
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 20,
          marginBottom: 40,
        }}
      >
        {[
          { icon: 'leaf' as const, rotate: '-20deg', size: 28, color: 'rgba(139,195,74,0.4)' },
          { icon: 'flower' as const, rotate: '0deg', size: 32, color: 'rgba(139,195,74,0.6)' },
          { icon: 'leaf' as const, rotate: '20deg', size: 28, color: 'rgba(139,195,74,0.4)' },
        ].map((item, i) => (
          <View
            key={i}
            style={{ transform: [{ rotate: item.rotate }] }}
          >
            <Ionicons name={item.icon} size={item.size} color={item.color} />
          </View>
        ))}
      </Animated.View>

      {/* CTA Button */}
      <Animated.View
        entering={FadeInDown.delay(700).duration(600)}
        style={{ width: '100%', maxWidth: 400 }}
      >
        <Pressable
          onPress={() => router.push('/(auth)/login')}
          style={({ pressed }) => ({
            backgroundColor: Colors.white,
            paddingVertical: 18,
            borderRadius: 16,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Ionicons name="arrow-forward" size={20} color={Colors.primaryDark} />
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 17,
              color: Colors.primaryDark,
            }}
          >
            Get Started
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
