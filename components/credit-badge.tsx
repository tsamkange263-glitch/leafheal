import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { useRouter } from 'expo-router';

interface CreditBadgeProps {
  credits: number;
  showTopUp?: boolean;
  compact?: boolean;
}

export function CreditBadge({ credits, showTopUp = true, compact = false }: CreditBadgeProps) {
  const router = useRouter();
  const isLow = credits <= 2;

  if (compact) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: isLow ? 'rgba(255,111,0,0.1)' : 'rgba(46,125,50,0.1)',
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 12,
          gap: 4,
        }}
      >
        <Ionicons
          name="scan"
          size={14}
          color={isLow ? Colors.warning : Colors.primary}
        />
        <Text
          style={{
            fontFamily: Fonts.semiBold,
            fontSize: 13,
            color: isLow ? Colors.warning : Colors.primary,
            fontVariant: ['tabular-nums'],
          }}
        >
          {credits} left
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: isLow ? 'rgba(255,111,0,0.12)' : 'rgba(46,125,50,0.12)',
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          gap: 6,
        }}
      >
        <Ionicons
          name="leaf"
          size={16}
          color={isLow ? Colors.warning : Colors.primary}
        />
        <Text
          style={{
            fontFamily: Fonts.bold,
            fontSize: 14,
            color: isLow ? Colors.warning : Colors.primary,
            fontVariant: ['tabular-nums'],
          }}
        >
          {credits} scans remaining
        </Text>
      </View>
      {showTopUp && (
        <Pressable
          onPress={() => router.push('/topup')}
          style={{
            backgroundColor: Colors.primary,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 13,
              color: Colors.white,
            }}
          >
            Top Up
          </Text>
        </Pressable>
      )}
    </View>
  );
}
