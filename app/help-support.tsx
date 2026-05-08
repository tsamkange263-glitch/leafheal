import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';

const SUPPORT_EMAIL = 'tsamkange263@gmail.com';

export default function HelpSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleEmailPress = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  };

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
          Help & Support
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 30,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero section */}
        <View
          style={{
            backgroundColor: Colors.card,
            borderRadius: 22,
            borderCurve: 'continuous',
            padding: 28,
            alignItems: 'center',
            gap: 16,
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: 'rgba(46,125,50,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="headset-outline"
              size={34}
              color={Colors.primary}
            />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.textPrimary,
              textAlign: 'center',
            }}
          >
            We&apos;re here to help
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 15,
              color: Colors.textSecondary,
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            Have a question, issue, or feedback? Reach out to our support team
            and we&apos;ll get back to you as soon as possible.
          </Text>
        </View>

        {/* Contact card */}
        <View
          style={{
            backgroundColor: Colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <View
            style={{
              backgroundColor: 'rgba(46,125,50,0.04)',
              padding: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: Colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 14,
                color: Colors.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              Contact Us
            </Text>
          </View>

          <Pressable
            onPress={handleEmailPress}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              padding: 18,
              gap: 14,
              opacity: pressed ? 0.8 : 1,
              backgroundColor: pressed
                ? 'rgba(46,125,50,0.03)'
                : 'transparent',
            })}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                borderCurve: 'continuous',
                backgroundColor: 'rgba(46,125,50,0.1)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="mail" size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 15,
                  color: Colors.textPrimary,
                  marginBottom: 2,
                }}
              >
                Email Support
              </Text>
              <Text
                selectable
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 14,
                  color: Colors.primary,
                }}
              >
                {SUPPORT_EMAIL}
              </Text>
            </View>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                borderCurve: 'continuous',
                backgroundColor: Colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="open-outline" size={16} color={Colors.white} />
            </View>
          </Pressable>
        </View>

        {/* FAQ / Tips section */}
        <View
          style={{
            backgroundColor: Colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <View
            style={{
              backgroundColor: 'rgba(46,125,50,0.04)',
              padding: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: Colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 14,
                color: Colors.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              Quick Tips
            </Text>
          </View>

          {[
            {
              icon: 'leaf-outline' as const,
              title: 'Scan Credits',
              desc: 'Each scan uses 1 credit. Top up credits from your Account page.',
            },
            {
              icon: 'camera-outline' as const,
              title: 'Best Results',
              desc: 'Take clear, well-lit photos of leaves or whole plants for accurate identification.',
            },
            {
              icon: 'bookmark-outline' as const,
              title: 'Save Remedies',
              desc: 'Archive useful remedy results to revisit them anytime from the Archive tab.',
            },
          ].map((tip, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                padding: 16,
                gap: 12,
                borderBottomWidth: i < 2 ? 0.5 : 0,
                borderBottomColor: Colors.border,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  borderCurve: 'continuous',
                  backgroundColor: 'rgba(46,125,50,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={tip.icon} size={18} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 14,
                    color: Colors.textPrimary,
                    marginBottom: 3,
                  }}
                >
                  {tip.title}
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 13,
                    color: Colors.textSecondary,
                    lineHeight: 19,
                  }}
                >
                  {tip.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Response time note */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 8,
          }}
        >
          <Ionicons name="time-outline" size={14} color={Colors.textLight} />
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 12,
              color: Colors.textLight,
            }}
          >
            We typically respond within 24 hours
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
