import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: Colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text
          style={{
            fontFamily: Fonts.bold,
            fontSize: 22,
            color: Colors.textPrimary,
          }}
        >
          About HerbScan
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 30,
          gap: 20,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* App icon / branding */}
        <View
          style={{
            width: 100,
            height: 100,
            borderRadius: 28,
            borderCurve: 'continuous',
            backgroundColor: Colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 20,
            boxShadow: '0 8px 24px rgba(46,125,50,0.3)',
          }}
        >
          <Ionicons name="leaf" size={48} color={Colors.white} />
        </View>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text
            style={{
              fontFamily: Fonts.extraBold,
              fontSize: 28,
              color: Colors.textPrimary,
            }}
          >
            HerbScan
          </Text>
          <Text
            style={{
              fontFamily: Fonts.medium,
              fontSize: 14,
              color: Colors.textSecondary,
            }}
          >
            Identify plants. Discover remedies.
          </Text>
        </View>

        {/* About content card */}
        <View
          style={{
            width: '100%',
            backgroundColor: Colors.card,
            borderRadius: 22,
            borderCurve: 'continuous',
            padding: 24,
            gap: 18,
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 15,
              color: Colors.textPrimary,
              lineHeight: 24,
              textAlign: 'center',
            }}
          >
            HerbScan is property of{' '}
            <Text style={{ fontFamily: Fonts.bold, color: Colors.primaryDark }}>
              QuomodoX, LLC
            </Text>
            , developed by{' '}
            <Text style={{ fontFamily: Fonts.bold, color: Colors.primaryDark }}>
              Tapiwa Samkange
            </Text>{' '}
            — the developer of Uniforum, Zimports and Truckit.
          </Text>

          {/* Divider */}
          <View
            style={{
              height: 1,
              backgroundColor: Colors.border,
              marginHorizontal: 20,
            }}
          />

          {/* Mission */}
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="heart" size={16} color={Colors.primary} />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 15,
                  color: Colors.textPrimary,
                }}
              >
                Our Mission
              </Text>
            </View>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 14,
                color: Colors.textSecondary,
                lineHeight: 22,
                textAlign: 'center',
              }}
            >
              Empowering communities with AI-powered plant identification and
              traditional herbal remedy knowledge — making nature&apos;s medicine
              accessible to everyone.
            </Text>
          </View>
        </View>

        {/* Features highlights */}
        <View
          style={{
            width: '100%',
            backgroundColor: Colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {[
            {
              icon: 'scan-outline' as const,
              title: 'AI Plant Identification',
              desc: 'Advanced AI recognizes thousands of plant species from photos',
            },
            {
              icon: 'flask-outline' as const,
              title: 'Herbal Remedies',
              desc: 'Traditional and evidence-based herbal remedy information',
            },
            {
              icon: 'shield-checkmark-outline' as const,
              title: 'Plant Health Analysis',
              desc: 'Detect diseases, pests, and nutrient deficiencies',
            },
          ].map((feature, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                padding: 16,
                gap: 14,
                alignItems: 'center',
                borderBottomWidth: i < 2 ? 0.5 : 0,
                borderBottomColor: Colors.border,
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  backgroundColor: 'rgba(46,125,50,0.1)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={feature.icon}
                  size={20}
                  color={Colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 14,
                    color: Colors.textPrimary,
                    marginBottom: 2,
                  }}
                >
                  {feature.title}
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 13,
                    color: Colors.textSecondary,
                    lineHeight: 18,
                  }}
                >
                  {feature.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Other products */}
        <View
          style={{
            width: '100%',
            backgroundColor: Colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
            padding: 20,
            gap: 14,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 14,
              color: Colors.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              textAlign: 'center',
            }}
          >
            Also by QuomodoX
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            {['Uniforum', 'Zimports', 'Truckit'].map((product) => (
              <View
                key={product}
                style={{
                  backgroundColor: 'rgba(46,125,50,0.08)',
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  borderCurve: 'continuous',
                }}
              >
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 13,
                    color: Colors.primary,
                  }}
                >
                  {product}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Version */}
        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 12,
            color: Colors.textLight,
            marginTop: 4,
          }}
        >
          Version 1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}
