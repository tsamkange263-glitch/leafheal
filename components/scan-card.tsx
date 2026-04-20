import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import type { Tables } from '@/lib/types';

interface ScanCardProps {
  scan: Tables<'scans'>;
  onPress: () => void;
  variant?: 'compact' | 'full';
}

export function ScanCard({ scan, onPress, variant = 'full' }: ScanCardProps) {
  const date = new Date(scan.created_at);
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timeAgo = getTimeAgo(date);

  if (variant === 'compact') {
    return (
      <Pressable
        onPress={onPress}
        style={{
          width: 110,
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View
          style={{
            width: 90,
            height: 90,
            borderRadius: 18,
            borderCurve: 'continuous',
            overflow: 'hidden',
            backgroundColor: Colors.background,
          }}
        >
          {scan.image_url ? (
            <Image
              source={{ uri: scan.image_url }}
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
        </View>
        <Text
          style={{
            fontFamily: Fonts.semiBold,
            fontSize: 13,
            color: Colors.textPrimary,
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {scan.plant_name || 'Unknown'}
        </Text>
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 11,
            color: Colors.textSecondary,
          }}
        >
          {timeAgo}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        backgroundColor: Colors.card,
        borderRadius: 16,
        borderCurve: 'continuous',
        padding: 12,
        gap: 12,
        alignItems: 'center',
        opacity: pressed ? 0.9 : 1,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
      })}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 14,
          borderCurve: 'continuous',
          overflow: 'hidden',
          backgroundColor: Colors.background,
        }}
      >
        {scan.image_url ? (
          <Image
            source={{ uri: scan.image_url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="leaf" size={24} color={Colors.accentLight} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: Fonts.bold,
            fontSize: 16,
            color: Colors.textPrimary,
          }}
          numberOfLines={1}
        >
          {scan.plant_name || 'Unknown Plant'}
        </Text>
        {scan.scientific_name && (
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 13,
              color: Colors.textSecondary,
              fontStyle: 'italic',
            }}
            numberOfLines={1}
          >
            {scan.scientific_name}
          </Text>
        )}
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 12,
            color: Colors.textLight,
          }}
        >
          {formattedDate}
        </Text>
      </View>
      {scan.confidence != null && (
        <View
          style={{
            backgroundColor:
              scan.confidence >= 0.8
                ? 'rgba(46,125,50,0.1)'
                : scan.confidence >= 0.5
                  ? 'rgba(255,111,0,0.1)'
                  : 'rgba(211,47,47,0.1)',
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 10,
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 13,
              fontVariant: ['tabular-nums'],
              color:
                scan.confidence >= 0.8
                  ? Colors.primary
                  : scan.confidence >= 0.5
                    ? Colors.warning
                    : Colors.error,
            }}
          >
            {Math.round(scan.confidence * 100)}%
          </Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </Pressable>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
