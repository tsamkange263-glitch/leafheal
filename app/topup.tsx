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
  generatePaymentReference,
  buildPaynowCheckoutUrl,
  sendEcoCashPayment,
  pollTransaction,
  isPaymentPaid,
  isPaymentPending,
  isPaymentCancelled,
  isPaymentFailed,
  isPaymentTimedOut,
  getPaymentFailureMessage,
  checkPaymentStatusFromDB,
  getPaymentConfig,
  type PaymentConfig,
  type PollResult,
} from '@/lib/paynow';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

type PaymentStatus = 'idle' | 'processing' | 'polling' | 'awaiting_card' | 'success' | 'failed';
type PaymentMethod = 'ecocash' | 'card';

// Fallback defaults (used while config is loading)
const DEFAULT_CARD_PAYMENT_AMOUNT_USD = 1.25;
const DEFAULT_SCANS_PER_TOPUP = 20;

// EcoCash polling: 6 attempts × 5 seconds = 30 seconds max (Truckit proven config)
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 6; // 6 * 5s = 30 seconds max
const CARD_DB_POLL_INTERVAL_MS = 4000;
const CARD_MAX_DB_POLL_ATTEMPTS = 45; // 45 * 4s = 3 minutes max


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
  const cardPaymentIdRef = useRef<string | null>(null);
  const cardDbPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardDbPollAttemptsRef = useRef(0);

  const credits = profile?.scan_credits ?? 0;

  // Derived config values (use fetched config or fallback defaults)
  // Both EcoCash and Card use the same amount from app_config.paynow_amount
  const PAYMENT_AMOUNT_USD = paymentConfig
    ? parseFloat(paymentConfig.paynow_amount)
    : DEFAULT_CARD_PAYMENT_AMOUNT_USD;
  const CARD_PAYMENT_AMOUNT_USD = PAYMENT_AMOUNT_USD;
  const SCANS_PER_TOPUP = paymentConfig?.scans_per_payment ?? DEFAULT_SCANS_PER_TOPUP;

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

      const onPaymentFailed = async (result: PollResult) => {
        // Determine the appropriate DB status based on Paynow response
        const dbStatus = isPaymentCancelled(result) ? 'failed' : isPaymentTimedOut(result) ? 'timeout' : 'failed';

        try {
          await supabase
            .from('payments')
            .update({ status: dbStatus })
            .eq('id', paymentId);
        } catch (err) {
          console.error('Failed to update payment status:', err);
        }

        // Get user-friendly message based on specific Paynow status
        const message = getPaymentFailureMessage(result);
        console.log('[paynow] Payment failed/cancelled. Status:', result.status, '| Message:', message);

        setStatus('failed');
        setErrorMsg(message);
      };

      const poll = async () => {
        if (isCancelledRef.current) return;

        pollAttemptsRef.current += 1;
        console.log(`[paynow] Poll attempt ${pollAttemptsRef.current}/${MAX_POLL_ATTEMPTS}`);

        try {
          const result = await pollTransaction(pollUrl);

          if (isCancelledRef.current) return;

          // SUCCESS: Payment confirmed
          if (isPaymentPaid(result)) {
            console.log('[paynow] Payment confirmed as PAID');
            await onPaymentConfirmed();
            return;
          }

          // FAILED/CANCELLED/TIMED OUT: Terminal failure states - stop polling immediately
          if (isPaymentFailed(result)) {
            console.log('[paynow] Payment terminal status detected:', result.status);
            await onPaymentFailed(result);
            return;
          }

          // PENDING: Still waiting for user action - continue polling
          if (isPaymentPending(result)) {
            if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
              // All attempts exhausted while still pending
              try {
                await supabase
                  .from('payments')
                  .update({ status: 'timeout' })
                  .eq('id', paymentId);
              } catch (err) {
                console.error('Failed to update payment timeout:', err);
              }

              setStatus('failed');
              setErrorMsg(
                'Payment timed out. You did not complete the EcoCash payment within 30 seconds. Please try again.'
              );
              return;
            }

            // Schedule next poll
            pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }

          // UNKNOWN STATUS: Not recognized - treat as pending but log for debugging
          console.warn('[paynow] Unknown poll status:', result.status);
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            // Exhausted attempts with unknown status - fail gracefully
            try {
              await supabase
                .from('payments')
                .update({ status: 'timeout' })
                .eq('id', paymentId);
            } catch (err) {
              console.error('Failed to update payment timeout:', err);
            }

            setStatus('failed');
            setErrorMsg(
              `Payment could not be confirmed (status: "${result.status || 'unknown'}"). Please try again or contact support.`
            );
            return;
          }
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch (e) {
          console.error('[paynow] Poll network error:', e);
          // Network error during polling - retry until max attempts
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            setStatus('failed');
            setErrorMsg(
              'Could not verify payment status due to a network issue. If you completed the payment, credits will be added shortly. Otherwise, please try again.'
            );
            return;
          }
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      // Start first poll immediately
      poll();
    },
    [credits, user?.id, updateCredits, SCANS_PER_TOPUP]
  );

  const handleEcoCashPayment = async () => {
    if (!user?.id) return;

    const cleanedPhone = phoneNumber.replace(/[\s\-()]/g, '');

    if (!validateZimPhone(cleanedPhone)) {
      Alert.alert(
        'Invalid Number',
        'Please enter a valid EcoCash number (077/078 prefix). Format: 07XXXXXXXX or 2637XXXXXXXX'
      );
      return;
    }

    setStatus('processing');
    setErrorMsg('');

    // Generate transaction reference using customer name (Truckit format)
    // Use user email prefix or user id as the "customer name"
    const customerName = user.email?.split('@')[0] || user.id.replace(/-/g, '');
    const reference = generateTransactionRef(customerName);

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
          payment_method: 'ecocash',
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Send EcoCash payment DIRECTLY to Paynow (Truckit proven approach - no Edge Function)
      const result = await sendEcoCashPayment(cleanedPhone, reference, PAYMENT_AMOUNT_USD);

      if (!result.success || !result.pollUrl) {
        // Update payment status to failed
        await supabase
          .from('payments')
          .update({ status: 'failed' })
          .eq('id', payment.id);

        setStatus('failed');
        setErrorMsg(result.error || 'Payment initiation failed. Please try again.');
        return;
      }

      // Update payment record to 'sent' status
      await supabase
        .from('payments')
        .update({ status: 'sent' })
        .eq('id', payment.id);

      // Payment request sent successfully - start polling (6 attempts × 5s = 30s)
      setStatus('polling');
      startPolling(result.pollUrl, payment.id);
    } catch (e: unknown) {
      let errorMessage = 'Failed to initiate payment. Please check your number and try again.';
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (typeof e === 'object' && e !== null) {
        const errObj = e as Record<string, unknown>;
        errorMessage = (errObj.message as string) || (errObj.error as string) || JSON.stringify(e);
      } else if (typeof e === 'string') {
        errorMessage = e;
      }
      console.error('EcoCash payment initiation error:', errorMessage, e);
      setStatus('failed');
      setErrorMsg(errorMessage);
    }
  };

  /**
   * Start background polling of the database for card payment status.
   * The webhook will update payment status in the DB when Paynow confirms.
   */
  const startCardDbPolling = useCallback(
    (paymentId: string) => {
      cardDbPollAttemptsRef.current = 0;
      isCancelledRef.current = false;

      const poll = async () => {
        if (isCancelledRef.current) return;
        cardDbPollAttemptsRef.current += 1;

        try {
          const dbStatus = await checkPaymentStatusFromDB(paymentId);

          if (isCancelledRef.current) return;

          if (dbStatus === 'success') {
            // Payment confirmed via webhook - update local state
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

          // Still pending - continue polling if under limit
          if (cardDbPollAttemptsRef.current >= CARD_MAX_DB_POLL_ATTEMPTS) {
            // Don't fail - let the user manually check
            return;
          }

          cardDbPollTimerRef.current = setTimeout(poll, CARD_DB_POLL_INTERVAL_MS);
        } catch (e) {
          console.error('Card DB poll error:', e);
          // Continue polling on error
          if (cardDbPollAttemptsRef.current < CARD_MAX_DB_POLL_ATTEMPTS) {
            cardDbPollTimerRef.current = setTimeout(poll, CARD_DB_POLL_INTERVAL_MS);
          }
        }
      };

      poll();
    },
    [user?.id, updateCredits]
  );

  /**
   * Manual status check triggered by user pressing "I've completed payment"
   */
  const handleManualStatusCheck = useCallback(async () => {
    const paymentId = cardPaymentIdRef.current;
    if (!paymentId || !user?.id) return;

    setIsCheckingManually(true);

    try {
      const dbStatus = await checkPaymentStatusFromDB(paymentId);

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
        // Still pending - show a message
        Alert.alert(
          'Payment Processing',
          'Payment processing, credits will be added shortly. If you\'ve completed payment on Paynow, please wait 30-60 seconds for the confirmation to be processed.',
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

  // Store the dynamic checkout URL for re-open functionality
  const cardCheckoutUrlRef = useRef<string | null>(null);

  const handleCardPayment = async () => {
    if (!user?.id) return;

    setStatus('processing');
    setErrorMsg('');

    // Generate unique payment reference for f1 custom field (reliable user identification)
    const paymentRef = generatePaymentReference(user.id);

    try {
      // Create payment record in database with the unique payment reference
      const { data: payment, error: insertErr } = await supabase
        .from('payments')
        .insert({
          user_id: user.id,
          ecocash_number: null,
          amount_usd: CARD_PAYMENT_AMOUNT_USD,
          scans_added: SCANS_PER_TOPUP,
          status: 'pending',
          paynow_reference: paymentRef, // Store the f1 reference for webhook matching
          payment_method: 'card',
        })
        .select()
        .single();

      if (insertErr) {
        console.error('Card payment DB insert error:', insertErr);
        throw new Error('Failed to create payment record. Please try again.');
      }

      cardPaymentIdRef.current = payment.id;

      // Build dynamic Paynow checkout URL with user reference in f1 field
      // Uses integration ID and amount from app_config table
      const userEmail = user.email || profile?.email || undefined;
      const config = paymentConfig ?? await getPaymentConfig();
      const checkoutUrl = buildPaynowCheckoutUrl(paymentRef, config, userEmail);
      cardCheckoutUrlRef.current = checkoutUrl;

      console.log('[topup] Opening dynamic Paynow checkout URL with ref:', paymentRef);

      // Open the dynamically constructed Paynow checkout page
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

      // Update payment record to 'sent' status
      await supabase
        .from('payments')
        .update({ status: 'sent' })
        .eq('id', payment.id);

      // Show "awaiting card payment" state and start background DB polling
      setStatus('awaiting_card');
      startCardDbPolling(payment.id);
    } catch (e: unknown) {
      let errorMessage = 'Failed to initiate card payment. Please try again.';
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (typeof e === 'object' && e !== null) {
        const errObj = e as Record<string, unknown>;
        errorMessage = (errObj.message as string) || (errObj.error as string) || JSON.stringify(e);
      } else if (typeof e === 'string') {
        errorMessage = e;
      }
      console.error('Card payment initiation error:', errorMessage, e);
      setStatus('failed');
      setErrorMsg(errorMessage);
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
    cardPaymentIdRef.current = null;
    setIsCheckingManually(false);
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
              ${PAYMENT_AMOUNT_USD.toFixed(2)}
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
              ~$0.06 per identification
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
                    ${CARD_PAYMENT_AMOUNT_USD.toFixed(2)} via Paynow secure checkout
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
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(26,35,126,0.06)',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  alignSelf: 'flex-start',
                }}
              >
                <Ionicons name="information-circle-outline" size={14} color="#1A237E" />
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 12,
                    color: '#1A237E',
                  }}
                >
                  Card total: ${CARD_PAYMENT_AMOUNT_USD.toFixed(2)} for {SCANS_PER_TOPUP} scans (~$0.06 per scan)
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
                  { step: '1', text: 'Enter your EcoCash mobile number' },
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
                  { step: '3', text: `Confirm the $${CARD_PAYMENT_AMOUNT_USD.toFixed(2)} payment` },
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

              {/* Real-time polling status */}
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
                    Waiting for payment confirmation...
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
                  {`• Check your phone for the EcoCash USSD prompt\n• Enter your PIN to confirm $${PAYMENT_AMOUNT_USD.toFixed(2)} payment\n• If you cancel on your phone, this screen will update automatically`}
                </Text>
              </View>
            </>
          )}

          {status === 'polling' && (
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
          )}
        </Animated.View>
      )}

      {/* Awaiting Card Payment - shown after browser opens */}
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
            {`Complete your $${CARD_PAYMENT_AMOUNT_USD.toFixed(2)} card payment on the Paynow checkout page that opened in your browser.`}
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
              Payment processing, credits will be added shortly
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
              {`• Your browser opened the Paynow secure checkout\n• Enter your Visa/Mastercard details and confirm $${CARD_PAYMENT_AMOUNT_USD.toFixed(2)}\n• Credits will be added automatically once confirmed\n• Tap "I've Completed Payment" to check your balance`}
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
