import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
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
  pollTransaction,
  generatePaymentReference,
  buildPaynowCheckoutUrl,
  checkPaymentStatusFromDB,
} from '@/lib/paynow';
import { getPaymentConfig, type PaymentConfig } from '@/lib/app-config';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

type PaymentStatus = 'idle' | 'processing' | 'polling' | 'awaiting_card' | 'success' | 'failed';
type PaymentMethod = 'ecocash' | 'card';

// Fallback defaults (used while config is loading)
const DEFAULT_ECOCASH_AMOUNT_USD = 1.25;
const DEFAULT_CARD_AMOUNT_USD = 1.25;
const DEFAULT_SCANS_PER_TOPUP = 20;

// EcoCash polling: 6 attempts × 5 seconds = 30 seconds max
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 6;

// Card DB polling: 45 attempts × 4 seconds = 3 minutes max
const CARD_DB_POLL_INTERVAL_MS = 4000;
const CARD_MAX_DB_POLL_ATTEMPTS = 45;

export default function TopUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ecocash');
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCheckingManually, setIsCheckingManually] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);
  const isCancelledRef = useRef(false);
  const pollUrlRef = useRef<string | null>(null);
  const paymentIdRef = useRef<string | null>(null);
  const cardPaymentIdRef = useRef<string | null>(null);
  const cardDbPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardDbPollAttemptsRef = useRef(0);
  const cardCheckoutUrlRef = useRef<string | null>(null);

  const credits = profile?.scan_credits ?? 0;

  // Derived config values — amounts come from app_config database table
  const ECOCASH_AMOUNT_USD = paymentConfig
    ? parseFloat(paymentConfig.paynow_ecocash_amount)
    : DEFAULT_ECOCASH_AMOUNT_USD;
  const CARD_AMOUNT_USD = paymentConfig
    ? parseFloat(paymentConfig.paynow_amount)
    : DEFAULT_CARD_AMOUNT_USD;
  const SCANS_PER_TOPUP = paymentConfig?.scans_per_payment ?? DEFAULT_SCANS_PER_TOPUP;

  // Show the amount for the currently selected method
  const displayAmount = paymentMethod === 'ecocash' ? ECOCASH_AMOUNT_USD : CARD_AMOUNT_USD;

  // Fetch payment configuration from database on mount
  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const config = await getPaymentConfig();
        if (!cancelled) {
          setPaymentConfig(config);
        }
      } catch (err) {
        console.error('[topup] Failed to load payment config:', err);
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  const cleanupPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (cardDbPollTimerRef.current) {
      clearTimeout(cardDbPollTimerRef.current);
      cardDbPollTimerRef.current = null;
    }
    isCancelledRef.current = true;
  }, []);

  // =========================================================================
  // EcoCash Polling: 6 attempts × 5s = 30 seconds
  // =========================================================================
  const startEcoCashPolling = useCallback(
    (pollUrl: string, paymentId: string) => {
      pollAttemptsRef.current = 0;
      isCancelledRef.current = false;
      pollUrlRef.current = pollUrl;
      paymentIdRef.current = paymentId;

      const poll = async () => {
        if (isCancelledRef.current) return;

        pollAttemptsRef.current += 1;
        console.log(`[paynow] Poll attempt ${pollAttemptsRef.current}/${MAX_POLL_ATTEMPTS}`);

        try {
          const result = await pollTransaction(pollUrl);

          if (isCancelledRef.current) return;

          // PAID: Payment confirmed
          if (result.paid) {
            console.log('[paynow] Payment confirmed as PAID');
            await supabase
              .from('payments')
              .update({ status: 'success' })
              .eq('id', paymentId)
              .eq('user_id', user!.id);

            if (user?.id) {
              const newCredits = credits + SCANS_PER_TOPUP;
              await supabase
                .from('users')
                .update({ scan_credits: newCredits })
                .eq('id', user.id);
              updateCredits(newCredits);
            }

            setStatus('success');
            return;
          }

          // CANCELLED or FAILED: Terminal — stop polling immediately
          const statusLower = result.status.toLowerCase();
          if (statusLower === 'cancelled' || statusLower === 'failed') {
            console.log('[paynow] Payment terminal status:', result.status);
            await supabase
              .from('payments')
              .update({ status: 'failed' })
              .eq('id', paymentId)
              .eq('user_id', user!.id);

            setStatus('failed');
            setErrorMsg(result.error || 'Payment was not completed.');
            return;
          }

          // Still pending — continue polling if under limit
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            await supabase
              .from('payments')
              .update({ status: 'timeout' })
              .eq('id', paymentId)
              .eq('user_id', user!.id);

            setStatus('failed');
            setErrorMsg(
              'Payment timed out or was not completed. If you entered your PIN, credits will be added shortly. Otherwise, please try again.'
            );
            return;
          }

          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch (e) {
          console.error('[paynow] Poll error:', e);
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

      // Start first poll after 5 seconds (give user time to see USSD prompt)
      pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    },
    [credits, user?.id, updateCredits, SCANS_PER_TOPUP]
  );

  // =========================================================================
  // Card DB Polling: webhook updates DB, we poll DB for status change
  // =========================================================================
  const startCardDbPolling = useCallback(
    (paymentId: string) => {
      cardDbPollAttemptsRef.current = 0;
      isCancelledRef.current = false;

      const poll = async () => {
        if (isCancelledRef.current) return;
        cardDbPollAttemptsRef.current += 1;

        try {
          const dbStatus = await checkPaymentStatusFromDB(paymentId, user?.id || '');

          if (isCancelledRef.current) return;

          if (dbStatus === 'success') {
            if (user?.id) {
              const { data: userData } = await supabase
                .from('users')
                .select('scan_credits')
                .eq('id', user.id)
                .single();
              if (userData) {
                updateCredits(userData.scan_credits);
              }
            }
            setStatus('success');
            return;
          }

          if (dbStatus === 'failed') {
            setStatus('failed');
            setErrorMsg('Payment was declined or cancelled. Please try again.');
            return;
          }

          // Still pending — continue polling if under limit
          if (cardDbPollAttemptsRef.current >= CARD_MAX_DB_POLL_ATTEMPTS) {
            return; // Don't fail — let user manually check
          }

          cardDbPollTimerRef.current = setTimeout(poll, CARD_DB_POLL_INTERVAL_MS);
        } catch (e) {
          console.error('Card DB poll error:', e);
          if (cardDbPollAttemptsRef.current < CARD_MAX_DB_POLL_ATTEMPTS) {
            cardDbPollTimerRef.current = setTimeout(poll, CARD_DB_POLL_INTERVAL_MS);
          }
        }
      };

      poll();
    },
    [user?.id, updateCredits]
  );

  // =========================================================================
  // EcoCash Payment Handler
  // =========================================================================
  const handleEcoCashPayment = async () => {
    if (!user?.id) return;

    const cleanedPhone = phoneNumber.replace(/[\s\-()]/g, '');
    const validation = validateZimPhone(cleanedPhone);

    if (!validation.valid) {
      Alert.alert('Invalid Number', validation.error || 'Please enter a valid EcoCash number (077/078 prefix).');
      return;
    }

    setStatus('processing');
    setErrorMsg('');

    const customerName = user.email?.split('@')[0] || user.id.replace(/-/g, '');
    const reference = generateTransactionRef(customerName);

    try {
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: cleanedPhone,
          amount_usd: ECOCASH_AMOUNT_USD,
          scans_added: SCANS_PER_TOPUP,
          status: 'pending',
          paynow_reference: reference,
          payment_method: 'ecocash',
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      const result = await sendEcoCashPayment(ECOCASH_AMOUNT_USD, cleanedPhone, reference);

      if (!result.success || !result.pollUrl) {
        await supabase
          .from('payments')
          .update({ status: 'failed' })
          .eq('id', payment.id)
          .eq('user_id', user.id);

        setStatus('failed');
        setErrorMsg(result.error || 'Transaction failed. Please try again.');
        return;
      }

      await supabase
        .from('payments')
        .update({ status: 'sent' })
        .eq('id', payment.id)
        .eq('user_id', user.id);

      setStatus('polling');
      startEcoCashPolling(result.pollUrl, payment.id);
    } catch (e: unknown) {
      let errorMessage = 'Failed to initiate payment. Please check your number and try again.';
      if (e instanceof Error) {
        errorMessage = e.message;
      }
      console.error('EcoCash payment error:', e);
      setStatus('failed');
      setErrorMsg(errorMessage);
    }
  };

  // =========================================================================
  // Card Payment Handler
  // =========================================================================
  const handleCardPayment = async () => {
    if (!user?.id) return;

    setStatus('processing');
    setErrorMsg('');

    const paymentRef = generatePaymentReference(user.id);

    try {
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: null,
          amount_usd: CARD_AMOUNT_USD,
          scans_added: SCANS_PER_TOPUP,
          status: 'pending',
          paynow_reference: paymentRef,
          payment_method: 'card',
        })
        .select()
        .single();

      if (insertErr) {
        console.error('Card payment DB insert error:', insertErr);
        throw new Error('Failed to create payment record. Please try again.');
      }

      cardPaymentIdRef.current = payment.id;

      const userEmail = user.email || profile?.email || undefined;
      const config = paymentConfig ?? await getPaymentConfig();
      const checkoutUrl = buildPaynowCheckoutUrl(paymentRef, config, userEmail);
      cardCheckoutUrlRef.current = checkoutUrl;

      console.log('[topup] Opening Paynow checkout URL with ref:', paymentRef);

      if (Platform.OS === 'web') {
        window.open(checkoutUrl, '_blank');
      } else {
        const canOpen = await Linking.canOpenURL(checkoutUrl);
        if (canOpen) {
          await Linking.openURL(checkoutUrl);
        } else {
          throw new Error('Unable to open checkout page. Please try again.');
        }
      }

      await supabase
        .from('payments')
        .update({ status: 'sent' })
        .eq('id', payment.id)
        .eq('user_id', user.id);

      setStatus('awaiting_card');
      startCardDbPolling(payment.id);
    } catch (e: unknown) {
      let errorMessage = 'Failed to initiate card payment. Please try again.';
      if (e instanceof Error) {
        errorMessage = e.message;
      }
      console.error('Card payment initiation error:', e);
      setStatus('failed');
      setErrorMsg(errorMessage);
    }
  };

  // =========================================================================
  // Manual Card Status Check
  // =========================================================================
  const handleManualStatusCheck = useCallback(async () => {
    const paymentId = cardPaymentIdRef.current;
    if (!paymentId || !user?.id) return;

    setIsCheckingManually(true);

    try {
      const dbStatus = await checkPaymentStatusFromDB(paymentId, user.id);

      if (dbStatus === 'success') {
        const { data: userData } = await supabase
          .from('users')
          .select('scan_credits')
          .eq('id', user.id)
          .single();
        if (userData) {
          updateCredits(userData.scan_credits);
        }
        cleanupPolling();
        setStatus('success');
      } else if (dbStatus === 'failed') {
        cleanupPolling();
        setStatus('failed');
        setErrorMsg('Payment was declined or cancelled. Please try again.');
      } else {
        Alert.alert(
          'Payment Processing',
          'Payment is still being processed. Credits will be added shortly. If you\'ve completed payment on Paynow, please wait 30-60 seconds.',
          [{ text: 'OK' }]
        );
      }
    } catch (e) {
      console.error('Manual status check error:', e);
      Alert.alert(
        'Check Failed',
        'Unable to verify payment status. Please wait a moment and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsCheckingManually(false);
    }
  }, [user?.id, updateCredits, cleanupPolling]);

  // =========================================================================
  // Unified Pay Handler
  // =========================================================================
  const handlePayment = () => {
    if (paymentMethod === 'ecocash') {
      handleEcoCashPayment();
    } else {
      handleCardPayment();
    }
  };

  const handleRetry = () => {
    cleanupPolling();
    pollUrlRef.current = null;
    paymentIdRef.current = null;
    cardPaymentIdRef.current = null;
    cardCheckoutUrlRef.current = null;
    setIsCheckingManually(false);
    setStatus('idle');
    setErrorMsg('');
  };

  const phoneValidation = validateZimPhone(phoneNumber.replace(/[\s\-()]/g, ''));
  const isPayButtonEnabled = paymentMethod === 'card' || phoneValidation.valid;

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
          {/* Config loading indicator */}
          {configLoading && (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={Colors.primary} />
            </View>
          )}

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
              ${displayAmount.toFixed(2)}
            </Text>
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 16,
                color: 'rgba(255,255,255,0.9)',
              }}
            >
              {SCANS_PER_TOPUP} Plant Scans
            </Text>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              ~${(displayAmount / SCANS_PER_TOPUP).toFixed(2)} per identification
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
                  <Ionicons name="phone-portrait" size={20} color={paymentMethod === 'ecocash' ? Colors.ecocash : Colors.textSecondary} />
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
                  <Ionicons name="card" size={20} color={paymentMethod === 'card' ? '#1A237E' : Colors.textSecondary} />
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
                    ${CARD_AMOUNT_USD.toFixed(2)} via Paynow secure checkout
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

          {/* Phone input — only shown for EcoCash */}
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
                    name={phoneValidation.valid ? 'checkmark-circle' : 'close-circle'}
                    size={22}
                    color={phoneValidation.valid ? Colors.success : Colors.error}
                  />
                )}
              </View>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 12,
                  color: phoneNumber.length > 0 && !phoneValidation.valid ? Colors.error : Colors.textSecondary,
                  marginLeft: 4,
                }}
              >
                {phoneNumber.length > 0 && !phoneValidation.valid
                  ? phoneValidation.error
                  : "Only 077 or 078 EcoCash numbers accepted"}
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
                gap: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
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
              </View>
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
                  { step: '1', text: 'Enter your EcoCash mobile number (077 or 078)' },
                  { step: '2', text: 'Tap "Pay with EcoCash"' },
                  { step: '3', text: 'Enter your EcoCash PIN on the USSD prompt' },
                  { step: '4', text: `${SCANS_PER_TOPUP} scan credits added instantly!` },
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
                  { step: '1', text: 'Tap "Pay with Card" to open Paynow checkout' },
                  { step: '2', text: 'Enter your Visa/Mastercard details securely' },
                  { step: '3', text: `Confirm the $${CARD_AMOUNT_USD.toFixed(2)} payment` },
                  { step: '4', text: `${SCANS_PER_TOPUP} scan credits added automatically!` },
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

      {/* Processing / EcoCash Polling state */}
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
              : 'Waiting for Payment Confirmation'}
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
                ? 'Sending EcoCash USSD push to your phone...'
                : 'Connecting to Paynow secure checkout...'
              : 'A payment request has been sent to your phone.\nEnter your EcoCash PIN to complete the transaction.'}
          </Text>

          {paymentMethod === 'ecocash' && status === 'polling' && (
            <>
              {/* Phone number badge */}
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

              {/* Polling status info */}
              <View
                style={{
                  backgroundColor: 'rgba(46,125,50,0.06)',
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                  gap: 10,
                  width: '100%',
                  maxWidth: 320,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text
                    style={{
                      fontFamily: Fonts.semiBold,
                      fontSize: 13,
                      color: Colors.textPrimary,
                    }}
                  >
                    Checking payment status...
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: Colors.textSecondary,
                    lineHeight: 18,
                  }}
                >
                  {`• Check your phone for the EcoCash USSD prompt\n• Enter your PIN to confirm $${ECOCASH_AMOUNT_USD.toFixed(2)} payment\n• This will timeout after 30 seconds`}
                </Text>
              </View>

              <View style={{ marginTop: 4, gap: 8, alignItems: 'center' }}>
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
                    Polling every 5s (up to 30s timeout)
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
            </>
          )}
        </Animated.View>
      )}

      {/* Awaiting Card Payment — shown after browser opens */}
      {status === 'awaiting_card' && (
        <Animated.View
          entering={FadeIn.duration(500)}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 40,
            gap: 20,
          }}
        >
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(26,35,126,0.08)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="hourglass-outline" size={44} color="#1A237E" />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.textPrimary,
              textAlign: 'center',
            }}
          >
            Complete Payment in Browser
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
            {`Complete your $${CARD_AMOUNT_USD.toFixed(2)} card payment on the Paynow checkout page that opened in your browser.`}
          </Text>

          {/* Animated status indicator */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'rgba(26,35,126,0.06)',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 12,
            }}
          >
            <ActivityIndicator size="small" color="#1A237E" />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: Colors.textSecondary,
              }}
            >
              Waiting for payment confirmation...
            </Text>
          </View>

          {/* I've completed payment button */}
          <Pressable
            onPress={handleManualStatusCheck}
            disabled={isCheckingManually}
            style={({ pressed }) => ({
              backgroundColor: '#1A237E',
              paddingVertical: 16,
              paddingHorizontal: 32,
              borderRadius: 14,
              borderCurve: 'continuous',
              marginTop: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              opacity: isCheckingManually ? 0.7 : pressed ? 0.9 : 1,
            })}
          >
            {isCheckingManually ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
            )}
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.white,
              }}
            >
              {isCheckingManually ? 'Checking...' : "I've Completed Payment"}
            </Text>
          </Pressable>

          {/* Re-open checkout in browser */}
          <Pressable
            onPress={() => {
              const url = cardCheckoutUrlRef.current;
              if (!url) return;
              if (Platform.OS === 'web') {
                window.open(url, '_blank');
              } else {
                Linking.openURL(url);
              }
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 10,
              paddingHorizontal: 16,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="open-outline" size={16} color="#1A237E" />
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 14,
                color: '#1A237E',
              }}
            >
              Re-open Checkout Page
            </Text>
          </Pressable>

          {/* Helpful info */}
          <View
            style={{
              marginTop: 8,
              backgroundColor: 'rgba(255,111,0,0.06)',
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingHorizontal: 16,
              paddingVertical: 12,
              gap: 8,
              width: '100%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.warning} />
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 13,
                  color: Colors.textPrimary,
                }}
              >
                What to expect
              </Text>
            </View>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: Colors.textSecondary,
                lineHeight: 18,
              }}
            >
              {`• Your browser opened the Paynow secure checkout\n• Enter your Visa/Mastercard details and confirm $${CARD_AMOUNT_USD.toFixed(2)}\n• Credits will be added automatically once confirmed\n• Tap "I've Completed Payment" to check your balance`}
            </Text>
          </View>

          {/* Cancel */}
          <Pressable
            onPress={handleRetry}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 20,
              marginTop: 4,
            }}
          >
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 14,
                color: Colors.error,
              }}
            >
              Cancel & Try Again
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Success state */}
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
            {SCANS_PER_TOPUP} scan credits have been added to your account
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

      {/* Failed state */}
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
