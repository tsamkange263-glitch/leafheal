import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
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
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

type PaymentStatus = 'idle' | 'processing' | 'polling' | 'success' | 'failed';

export default function TopUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const credits = profile?.scan_credits ?? 0;

  const validatePhone = (phone: string): boolean => {
    const cleaned = phone.replace(/\s/g, '');
    return /^07\d{8}$/.test(cleaned);
  };

  const handlePayment = async () => {
    if (!user?.id) return;

    if (!validatePhone(phoneNumber)) {
      Alert.alert(
        'Invalid Number',
        'Please enter a valid EcoCash number in format: 07XXXXXXXX'
      );
      return;
    }

    setStatus('processing');
    setErrorMsg('');

    try {
      // Create payment record
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: phoneNumber.replace(/\s/g, ''),
          amount_usd: 1.0,
          scans_added: 12,
          status: 'pending',
          paynow_reference: `HERB-${Date.now()}`,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Simulate USSD push polling
      setStatus('polling');

      // Simulate payment confirmation after delay (in production, poll Paynow API)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Update payment status to success
      await supabase
        .from('payments')
        .update({ status: 'success' })
        .eq('id', payment.id);

      // Add credits
      const newCredits = credits + 12;
      await supabase
        .from('users')
        .update({ scan_credits: newCredits })
        .eq('id', user.id);
      updateCredits(newCredits);

      setStatus('success');
    } catch (e: unknown) {
      console.error('Payment error:', e);
      setStatus('failed');
      setErrorMsg(e instanceof Error ? e.message : 'Payment failed. Please try again.');
    }
  };

  const handleRetry = () => {
    setStatus('idle');
    setErrorMsg('');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: Colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 24,
            color: Colors.textPrimary,
          }}
        >
          Top Up Credits
        </Text>
      </View>

      {status === 'idle' && (
        <>
          {/* Pricing card */}
          <Animated.View
            entering={FadeInDown.duration(500)}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 24,
              borderCurve: 'continuous',
              padding: 24,
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(46,125,50,0.3)',
            }}
          >
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: 'rgba(255,255,255,0.15)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="leaf" size={30} color={Colors.white} />
            </View>
            <Text
              style={{
                fontFamily: Fonts.extraBold,
                fontSize: 36,
                color: Colors.white,
                fontVariant: ['tabular-nums'],
              }}
            >
              $1.00
            </Text>
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 16,
                color: 'rgba(255,255,255,0.9)',
              }}
            >
              12 Plant Scans
            </Text>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              ~$0.08 per identification
            </Text>

            {/* Current balance */}
            <View
              style={{
                marginTop: 8,
                backgroundColor: 'rgba(255,255,255,0.15)',
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 16,
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 13,
                  color: Colors.white,
                  fontVariant: ['tabular-nums'],
                }}
              >
                Current balance: {credits} scans
              </Text>
            </View>
          </Animated.View>

          {/* Phone input */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(500)}
            style={{ marginTop: 24, gap: 8 }}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 15,
                color: Colors.textPrimary,
                marginLeft: 4,
              }}
            >
              EcoCash Mobile Number
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: Colors.card,
                borderRadius: 16,
                borderCurve: 'continuous',
                borderWidth: 2,
                borderColor: Colors.border,
                paddingHorizontal: 16,
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: 'rgba(233,30,99,0.1)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="phone-portrait-outline" size={16} color={Colors.ecocash} />
              </View>
              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="07XXXXXXXX"
                placeholderTextColor={Colors.textLight}
                keyboardType="phone-pad"
                maxLength={10}
                style={{
                  flex: 1,
                  fontFamily: Fonts.semiBold,
                  fontSize: 18,
                  color: Colors.textPrimary,
                  paddingVertical: 16,
                  letterSpacing: 1,
                }}
              />
              {phoneNumber.length > 0 && (
                <Ionicons
                  name={validatePhone(phoneNumber) ? 'checkmark-circle' : 'close-circle'}
                  size={22}
                  color={validatePhone(phoneNumber) ? Colors.success : Colors.error}
                />
              )}
            </View>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: Colors.textSecondary,
                marginLeft: 4,
              }}
            >
              {"You'll receive a USSD push on this number to confirm"}
            </Text>
          </Animated.View>

          {/* Pay button */}
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <Pressable
              onPress={handlePayment}
              disabled={!validatePhone(phoneNumber)}
              style={({ pressed }) => ({
                backgroundColor: Colors.ecocash,
                paddingVertical: 18,
                borderRadius: 16,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                marginTop: 20,
                opacity: validatePhone(phoneNumber)
                  ? pressed
                    ? 0.9
                    : 1
                  : 0.5,
              })}
            >
              <Ionicons name="wallet" size={20} color={Colors.white} />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 17,
                  color: Colors.white,
                }}
              >
                Pay with EcoCash
              </Text>
            </Pressable>
          </Animated.View>

          {/* How it works */}
          <View style={{ marginTop: 28, gap: 12 }}>
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.textPrimary,
              }}
            >
              How it works
            </Text>
            {[
              { step: '1', text: 'Enter your EcoCash mobile number' },
              { step: '2', text: 'Tap "Pay with EcoCash"' },
              { step: '3', text: 'Approve the USSD push on your phone' },
              { step: '4', text: '12 scan credits added instantly!' },
            ].map((item, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: 'rgba(46,125,50,0.1)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: Fonts.bold,
                      fontSize: 13,
                      color: Colors.primary,
                    }}
                  >
                    {item.step}
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 14,
                    color: Colors.textSecondary,
                  }}
                >
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {(status === 'processing' || status === 'polling') && (
        <Animated.View
          entering={FadeIn.duration(500)}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 60,
            gap: 20,
          }}
        >
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(233,30,99,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator size="large" color={Colors.ecocash} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.textPrimary,
              textAlign: 'center',
            }}
          >
            {status === 'processing'
              ? 'Initiating Payment...'
              : 'Waiting for Confirmation'}
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              lineHeight: 22,
              maxWidth: 280,
            }}
          >
            {status === 'processing'
              ? 'Connecting to EcoCash...'
              : 'Check your phone for the USSD prompt and enter your EcoCash PIN to confirm'}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(255,111,0,0.08)',
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 12,
            }}
          >
            <Ionicons name="phone-portrait" size={16} color={Colors.warning} />
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 13,
                color: Colors.warning,
              }}
            >
              {phoneNumber}
            </Text>
          </View>
        </Animated.View>
      )}

      {status === 'success' && (
        <Animated.View
          entering={FadeIn.duration(500)}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 60,
            gap: 16,
          }}
        >
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(46,125,50,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark-circle" size={60} color={Colors.primary} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.extraBold,
              fontSize: 24,
              color: Colors.primary,
            }}
          >
            Payment Successful!
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 15,
              color: Colors.textSecondary,
              textAlign: 'center',
            }}
          >
            12 scan credits have been added to your account
          </Text>
          <View
            style={{
              backgroundColor: Colors.primary,
              paddingHorizontal: 24,
              paddingVertical: 10,
              borderRadius: 20,
              marginTop: 4,
            }}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 18,
                color: Colors.white,
                fontVariant: ['tabular-nums'],
              }}
            >
              {credits} scans
            </Text>
          </View>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              backgroundColor: Colors.primary,
              paddingVertical: 16,
              paddingHorizontal: 40,
              borderRadius: 14,
              borderCurve: 'continuous',
              marginTop: 20,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.white,
              }}
            >
              Start Scanning
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {status === 'failed' && (
        <Animated.View
          entering={FadeIn.duration(500)}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 60,
            gap: 16,
          }}
        >
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(211,47,47,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close-circle" size={60} color={Colors.error} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 22,
              color: Colors.error,
            }}
          >
            Payment Failed
          </Text>
          <Text
            selectable
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            {errorMsg || 'Something went wrong. Please try again.'}
          </Text>

          <Pressable
            onPress={handleRetry}
            style={({ pressed }) => ({
              backgroundColor: Colors.primary,
              paddingVertical: 16,
              paddingHorizontal: 40,
              borderRadius: 14,
              borderCurve: 'continuous',
              marginTop: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.white,
              }}
            >
              Try Again
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </ScrollView>
  );
}
