import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';

interface LeafLogoProps {
  size?: 'small' | 'large';
  color?: string;
}

export function LeafLogo({ size = 'large', color = Colors.primary }: LeafLogoProps) {
  const isLarge = size === 'large';
  const iconSize = isLarge ? 48 : 28;
  const containerSize = isLarge ? 100 : 56;

  return (
    <View style={{ alignItems: 'center', gap: isLarge ? 12 : 6 }}>
      <View
        style={{
          width: containerSize,
          height: containerSize,
          borderRadius: containerSize / 2,
          backgroundColor: color === Colors.white ? 'rgba(255,255,255,0.15)' : 'rgba(46,125,50,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: containerSize * 0.75,
            height: containerSize * 0.75,
            borderRadius: (containerSize * 0.75) / 2,
            backgroundColor: color === Colors.white ? 'rgba(255,255,255,0.2)' : 'rgba(46,125,50,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="leaf" size={iconSize} color={color} />
        </View>
      </View>
      <Text
        style={{
          fontFamily: Fonts.extraBold,
          fontSize: isLarge ? 32 : 20,
          color: color,
          letterSpacing: -0.5,
        }}
      >
        HerbScan
      </Text>
      {isLarge && (
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 14,
            color: color === Colors.white ? 'rgba(255,255,255,0.8)' : Colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {"Identify plants. Discover nature's medicine."}
        </Text>
      )}
    </View>
  );
}
