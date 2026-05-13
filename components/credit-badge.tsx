import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { useRouter } from 'expo-router';

interface CreditBadgeProps {
  credits: number;
  showTopUp?: boolean;
  compact?: boolean;
  isTrial?: boolean;
}

export function CreditBadge({ credits, showTopUp = true, compact = false, isTrial = false }: CreditBadgeProps) {
  const router = useRouter();
  const isLow = credits <= 2;
  const isEmpty = credits === 0;

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
    <View style={{ gap: 6 }}>
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
            backgroundColor: isEmpty
              ? 'rgba(211,47,47,0.1)'
              : isLow
                ? 'rgba(255,111,0,0.12)'
                : 'rgba(46,125,50,0.12)',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 20,
            gap: 6,
          }}
        >
          <Ionicons
            name={isTrial ? 'gift' : 'leaf'}
            size={16}
            color={isEmpty ? Colors.error : isLow ? Colors.warning : Colors.primary}
          />
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 14,
              color: isEmpty ? Colors.error : isLow ? Colors.warning : Colors.primary,
              fontVariant: ['tabular-nums'],
            }}
          >
            {isEmpty
              ? 'No scans left'
              : isTrial
                ? `${credits} free scans remaining`
                : `${credits} scans remaining`}
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
      {isTrial && credits > 0 && (
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 12,
            color: Colors.textSecondary,
            marginLeft: 4,
          }}
        >
          Try the app free — top up anytime for more
        </Text>
      )}
      {isEmpty && (
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 12,
            color: Colors.textSecondary,
            marginLeft: 4,
          }}
        >
          Top up for $1.25 to get 15 plant scans
        </Text>
      )}
    </View>
  );
}
