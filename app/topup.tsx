import { useState, useRef, useCallback } from 'react';
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
import {
  validateZimPhone,
  generateTransactionRef,
  sendEcoCashPayment,
  initiateCardPayment,
  pollTransaction,
  isPaymentPaid,
  isPaymentPending,
  isPaymentFailed,
} from '@/lib/paynow';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';

type PaymentStatus = 'idle' | 'processing' | 'polling' | 'success' | 'failed';
type PaymentMethod = 'ecocash' | 'card';

const PAYMENT_AMOUNT_USD = 1.0;
const SCANS_PER_TOPUP = 12;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 12; // 12 * 5s = 60 seconds max

export default function TopUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ecocash');
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);
  const isCancelledRef = useRef(false);

  const credits = profile?.scan_credits ?? 0;

  const cleanupPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    isCancelledRef.current = true;
  }, []);

  const startPolling = useCallback(
    async (pollUrl: string, paymentId: string) => {
      pollAttemptsRef.current = 0;
      isCancelledRef.current = false;

      const onPaymentConfirmed = async () => {
        if (!user?.id) return;
        try {
          await supabase
            .from('payments')
            .update({ status: 'success' })
            .eq('id', paymentId);

          const newCredits = credits + SCANS_PER_TOPUP;
          await supabase
            .from('users')
            .update({ scan_credits: newCredits })
            .eq('id', user.id);
          updateCredits(newCredits);

          setStatus('success');
        } catch (e) {
          console.error('Success handling error:', e);
          // Payment was successful but credits update failed - still show success
          setStatus('success');
        }
      };

      const poll = async () => {
        if (isCancelledRef.current) return;

        pollAttemptsRef.current += 1;

        try {
          const result = await pollTransaction(pollUrl);

          if (isCancelledRef.current) return;

          if (isPaymentPaid(result)) {
            await onPaymentConfirmed();
            return;
          }

          if (isPaymentFailed(result)) {
            await supabase
              .from('payments')
              .update({ status: 'failed' })
              .eq('id', paymentId);
            setStatus('failed');
            setErrorMsg(
              'Payment was declined or cancelled. Please try again.'
            );
            return;
          }

          if (isPaymentPending(result)) {
            if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
              await supabase
                .from('payments')
                .update({ status: 'timeout' })
                .eq('id', paymentId);
              setStatus('failed');
              setErrorMsg(
                'Payment confirmation timed out. If you completed the payment, credits will be added shortly. Contact support if needed.'
              );
              return;
            }

            pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }

          // Unknown status - keep polling until max attempts
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            setStatus('failed');
            setErrorMsg(
              `Unexpected payment status: "${result.status}". Please contact support.`
            );
            return;
          }
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch (e) {
          console.error('Poll error:', e);
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            setStatus('failed');
            setErrorMsg(
              'Could not verify payment status. If you completed the payment, credits will be added shortly.'
            );
            return;
          }
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      // Start first poll
      poll();
    },
    [credits, user?.id, updateCredits]
  );

  const handleEcoCashPayment = async () => {
    if (!user?.id) return;

    const cleanedPhone = phoneNumber.replace(/[\s\-()]/g, '');

    if (!validateZimPhone(cleanedPhone)) {
      Alert.alert(
        'Invalid Number',
        'Please enter a valid EcoCash number in format: 07XXXXXXXX or 263XXXXXXXXX'
      );
      return;
    }

    setStatus('processing');
    setErrorMsg('');

    const reference = generateTransactionRef();

    try {
      // Create payment record in database first
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: cleanedPhone,
          amount_usd: PAYMENT_AMOUNT_USD,
          scans_added: SCANS_PER_TOPUP,
          status: 'pending',
          paynow_reference: reference,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Send EcoCash payment request to Paynow
      const paynowResponse = await sendEcoCashPayment(
        PAYMENT_AMOUNT_USD,
        cleanedPhone,
        reference
      );

      // Update payment record with poll URL for tracking
      if (paynowResponse.pollurl) {
        await supabase
          .from('payments')
          .update({
            status: 'sent',
            paynow_reference: paynowResponse.browserurl || reference,
          })
          .eq('id', payment.id);
      }

      // Payment request sent successfully - start polling
      setStatus('polling');
      startPolling(paynowResponse.pollurl!, payment.id);
    } catch (e: unknown) {
      console.error('Payment initiation error:', e);
      setStatus('failed');
      setErrorMsg(
        e instanceof Error
          ? e.message
          : 'Failed to initiate payment. Please check your number and try again.'
      );
    }
  };

  const handleCardPayment = async () => {
    if (!user?.id) return;

    setStatus('processing');
    setErrorMsg('');

    const reference = generateTransactionRef();
    const userEmail = user.email || '';

    try {
      // Create payment record in database
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: null,
          amount_usd: PAYMENT_AMOUNT_USD,
          scans_added: SCANS_PER_TOPUP,
          status: 'pending',
          paynow_reference: reference,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Initiate standard web checkout
      const paynowResponse = await initiateCardPayment(
        PAYMENT_AMOUNT_USD,
        reference,
        userEmail
      );

      // Update payment record
      await supabase
        .from('payments')
        .update({
          status: 'sent',
          paynow_reference: paynowResponse.browserurl || reference,
        })
        .eq('id', payment.id);

      // Open the Paynow checkout page in browser
      if (paynowResponse.browserurl) {
        await WebBrowser.openBrowserAsync(paynowResponse.browserurl, {
          dismissButtonStyle: 'done',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        });
      }

      // After browser closes, start polling for payment confirmation
      setStatus('polling');
      startPolling(paynowResponse.pollurl!, payment.id);
    } catch (e: unknown) {
      console.error('Card payment initiation error:', e);
      setStatus('failed');
      setErrorMsg(
        e instanceof Error
          ? e.message
          : 'Failed to initiate card payment. Please try again.'
      );
    }
  };

  const handlePayment = () => {
    if (paymentMethod === 'ecocash') {
      handleEcoCashPayment();
    } else {
      handleCardPayment();
    }
  };

  const handleRetry = () => {
    cleanupPolling();
    setStatus('idle');
    setErrorMsg('');
  };

  const isEcoCashValid = validateZimPhone(phoneNumber.replace(/[\s\-()]/g, ''));
  const isPayButtonEnabled = paymentMethod === 'card' || isEcoCashValid;

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
          onPress={() => {
            cleanupPolling();
            router.back();
          }}
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

          {/* Payment Method Selector */}
          <Animated.View
            entering={FadeInDown.delay(80).duration(500)}
            style={{ marginTop: 24, gap: 10 }}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 15,
                color: Colors.textPrimary,
                marginLeft: 4,
              }}
            >
              Payment Method
            </Text>
            <View style={{ gap: 10 }}>
              {/* EcoCash option */}
              <Pressable
                onPress={() => setPaymentMethod('ecocash')}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: Colors.card,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: paymentMethod === 'ecocash' ? Colors.ecocash : Colors.border,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  gap: 12,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    backgroundColor: paymentMethod === 'ecocash' ? 'rgba(233,30,99,0.1)' : 'rgba(0,0,0,0.04)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 20 }}>💚</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: Fonts.bold,
                      fontSize: 15,
                      color: Colors.textPrimary,
                    }}
                  >
                    EcoCash
                  </Text>
                  <Text
                    style={{
                      fontFamily: Fonts.regular,
                      fontSize: 12,
                      color: Colors.textSecondary,
                      marginTop: 1,
                    }}
                  >
                    Pay via USSD push to your phone
                  </Text>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: 2,
                    borderColor: paymentMethod === 'ecocash' ? Colors.ecocash : Colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {paymentMethod === 'ecocash' && (
                    <View
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: Colors.ecocash,
                      }}
                    />
                  )}
                </View>
              </Pressable>

              {/* Visa/Mastercard option */}
              <Pressable
                onPress={() => setPaymentMethod('card')}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: Colors.card,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: paymentMethod === 'card' ? '#1A237E' : Colors.border,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  gap: 12,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    backgroundColor: paymentMethod === 'card' ? 'rgba(26,35,126,0.08)' : 'rgba(0,0,0,0.04)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 20 }}>💳</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: Fonts.bold,
                      fontSize: 15,
                      color: Colors.textPrimary,
                    }}
                  >
                    Visa / Mastercard
                  </Text>
                  <Text
                    style={{
                      fontFamily: Fonts.regular,
                      fontSize: 12,
                      color: Colors.textSecondary,
                      marginTop: 1,
                    }}
                  >
                    Pay securely with your bank card
                  </Text>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: 2,
                    borderColor: paymentMethod === 'card' ? '#1A237E' : Colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {paymentMethod === 'card' && (
                    <View
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: '#1A237E',
                      }}
                    />
                  )}
                </View>
              </Pressable>
            </View>
          </Animated.View>

          {/* Phone input - only shown for EcoCash */}
          {paymentMethod === 'ecocash' && (
            <Animated.View
              entering={FadeInDown.duration(400)}
              style={{ marginTop: 20, gap: 8 }}
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
                  maxLength={12}
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
                    name={isEcoCashValid ? 'checkmark-circle' : 'close-circle'}
                    size={22}
                    color={isEcoCashValid ? Colors.success : Colors.error}
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
                {"You'll receive a USSD push on this number to confirm payment"}
              </Text>
            </Animated.View>
          )}

          {/* Card info message */}
          {paymentMethod === 'card' && (
            <Animated.View
              entering={FadeInDown.duration(400)}
              style={{
                marginTop: 20,
                backgroundColor: 'rgba(26,35,126,0.05)',
                borderRadius: 14,
                borderCurve: 'continuous',
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Ionicons name="lock-closed" size={18} color="#1A237E" />
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 13,
                  color: Colors.textSecondary,
                  flex: 1,
                  lineHeight: 19,
                }}
              >
                {"You'll be redirected to Paynow's secure checkout page to enter your card details."}
              </Text>
            </Animated.View>
          )}

          {/* Pay button */}
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <Pressable
              onPress={handlePayment}
              disabled={!isPayButtonEnabled}
              style={({ pressed }) => ({
                backgroundColor: paymentMethod === 'ecocash' ? Colors.ecocash : '#1A237E',
                paddingVertical: 18,
                borderRadius: 16,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                marginTop: 20,
                opacity: isPayButtonEnabled
                  ? pressed
                    ? 0.9
                    : 1
                  : 0.5,
              })}
            >
              <Ionicons
                name={paymentMethod === 'ecocash' ? 'wallet' : 'card'}
                size={20}
                color={Colors.white}
              />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 17,
                  color: Colors.white,
                }}
              >
                {paymentMethod === 'ecocash' ? 'Pay with EcoCash' : 'Pay with Card'}
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
            {paymentMethod === 'ecocash'
              ? [
                  { step: '1', text: 'Enter your EcoCash mobile number' },
                  { step: '2', text: 'Tap "Pay with EcoCash"' },
                  { step: '3', text: 'Enter your EcoCash PIN on the USSD prompt' },
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
                ))
              : [
                  { step: '1', text: 'Tap "Pay with Card"' },
                  { step: '2', text: 'Enter your Visa/Mastercard details on Paynow' },
                  { step: '3', text: 'Confirm the $1.00 payment' },
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
                        backgroundColor: 'rgba(26,35,126,0.08)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: Fonts.bold,
                          fontSize: 13,
                          color: '#1A237E',
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

          {/* Security note */}
          <View
            style={{
              marginTop: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: 'rgba(46,125,50,0.06)',
              borderRadius: 12,
              borderCurve: 'continuous',
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={16} color={Colors.primary} />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: Colors.textSecondary,
                flex: 1,
              }}
            >
              Payments are processed securely via Paynow Zimbabwe
            </Text>
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
              backgroundColor: paymentMethod === 'ecocash' ? 'rgba(233,30,99,0.1)' : 'rgba(26,35,126,0.08)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator size="large" color={paymentMethod === 'ecocash' ? Colors.ecocash : '#1A237E'} />
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
              : paymentMethod === 'ecocash'
              ? 'Waiting for Confirmation'
              : 'Verifying Card Payment'}
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              lineHeight: 22,
              maxWidth: 300,
            }}
          >
            {status === 'processing'
              ? paymentMethod === 'ecocash'
                ? 'Connecting to EcoCash via Paynow...'
                : 'Connecting to Paynow secure checkout...'
              : paymentMethod === 'ecocash'
              ? 'A payment request has been sent to your phone. Enter your EcoCash PIN to complete the transaction.'
              : 'Checking if your card payment was completed successfully...'}
          </Text>

          {paymentMethod === 'ecocash' && status === 'polling' && (
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
          )}

          {status === 'polling' && (
            <View style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(46,125,50,0.08)',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 12,
                }}
              >
                <Ionicons name="time-outline" size={14} color={Colors.primary} />
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: Colors.textSecondary,
                  }}
                >
                  Checking payment status...
                </Text>
              </View>

              <Pressable
                onPress={handleRetry}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  marginTop: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 14,
                    color: Colors.error,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>
          )}
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
              maxWidth: 300,
              lineHeight: 21,
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
