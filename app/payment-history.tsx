import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { extractErrorMessage } from '@/lib/error-utils';
import type { Tables } from '@/lib/types';

function formatDateTime(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { date, time };
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'success':
      return {
        color: Colors.success,
        bgColor: 'rgba(46,125,50,0.1)',
        icon: 'checkmark-circle' as const,
        label: 'Successful',
      };
    case 'failed':
      return {
        color: Colors.error,
        bgColor: 'rgba(211,47,47,0.1)',
        icon: 'close-circle' as const,
        label: 'Failed',
      };
    case 'pending':
      return {
        color: Colors.warning,
        bgColor: 'rgba(255,111,0,0.1)',
        icon: 'time' as const,
        label: 'Pending',
      };
    default:
      return {
        color: Colors.textSecondary,
        bgColor: 'rgba(90,122,94,0.1)',
        icon: 'help-circle' as const,
        label: status,
      };
  }
}

export default function PaymentHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [payments, setPayments] = useState<Tables<'payments'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setPayments(data ?? []);
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Failed to load payment history'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPayments();
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
          Payment History
        </Text>
      </View>

      {/* Content */}
      {loading ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text
            style={{
              fontFamily: Fonts.medium,
              fontSize: 14,
              color: Colors.textSecondary,
              marginTop: 12,
            }}
          >
            Loading payments...
          </Text>
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 40,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: 'rgba(211,47,47,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Ionicons name="alert-circle" size={32} color={Colors.error} />
          </View>
          <Text
            selectable
            style={{
              fontFamily: Fonts.semiBold,
              fontSize: 16,
              color: Colors.textPrimary,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            Failed to load payments
          </Text>
          <Text
            selectable
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            {error}
          </Text>
          <Pressable
            onPress={fetchPayments}
            style={({ pressed }) => ({
              backgroundColor: Colors.primary,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 12,
              borderCurve: 'continuous',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 14,
                color: Colors.white,
              }}
            >
              Try Again
            </Text>
          </Pressable>
        </View>
      ) : payments.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 40,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: 'rgba(46,125,50,0.08)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <Ionicons name="receipt-outline" size={36} color={Colors.primary} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 18,
              color: Colors.textPrimary,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            No payments yet
          </Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            Your payment history will appear here after you top up your scan
            credits.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 20,
            gap: 12,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {/* Summary */}
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              marginBottom: 4,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: Colors.card,
                borderRadius: 14,
                borderCurve: 'continuous',
                padding: 14,
                alignItems: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 20,
                  color: Colors.primary,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {payments.length}
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 12,
                  color: Colors.textSecondary,
                }}
              >
                Total Payments
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: Colors.card,
                borderRadius: 14,
                borderCurve: 'continuous',
                padding: 14,
                alignItems: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 20,
                  color: Colors.primary,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {payments
                  .filter((p) => p.status === 'success')
                  .reduce((sum, p) => sum + p.scans_added, 0)}
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 12,
                  color: Colors.textSecondary,
                }}
              >
                Scans Purchased
              </Text>
            </View>
          </View>

          {/* Payment list */}
          <View
            style={{
              backgroundColor: Colors.card,
              borderRadius: 18,
              borderCurve: 'continuous',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
          >
            {payments.map((payment, index) => {
              const { date, time } = formatDateTime(payment.created_at);
              const statusConfig = getStatusConfig(payment.status);

              return (
                <View
                  key={payment.id}
                  style={{
                    padding: 16,
                    borderBottomWidth: index < payments.length - 1 ? 0.5 : 0,
                    borderBottomColor: Colors.border,
                    gap: 10,
                  }}
                >
                  {/* Top row: status icon + amount */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          borderCurve: 'continuous',
                          backgroundColor: statusConfig.bgColor,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons
                          name={statusConfig.icon}
                          size={20}
                          color={statusConfig.color}
                        />
                      </View>
                      <View>
                        <Text
                          style={{
                            fontFamily: Fonts.bold,
                            fontSize: 16,
                            color: Colors.textPrimary,
                            fontVariant: ['tabular-nums'],
                          }}
                        >
                          ${payment.amount_usd.toFixed(2)}
                        </Text>
                        <Text
                          style={{
                            fontFamily: Fonts.medium,
                            fontSize: 13,
                            color: Colors.textSecondary,
                          }}
                        >
                          +{payment.scans_added} scan
                          {payment.scans_added !== 1 ? 's' : ''} added
                        </Text>
                      </View>
                    </View>
                    <View
                      style={{
                        backgroundColor: statusConfig.bgColor,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        borderCurve: 'continuous',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: Fonts.semiBold,
                          fontSize: 11,
                          color: statusConfig.color,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}
                      >
                        {statusConfig.label}
                      </Text>
                    </View>
                  </View>

                  {/* Bottom row: date + reference */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingLeft: 48,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={13}
                        color={Colors.textLight}
                      />
                      <Text
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 12,
                          color: Colors.textLight,
                        }}
                      >
                        {date} · {time}
                      </Text>
                    </View>
                    {payment.paynow_reference && (
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.medium,
                          fontSize: 11,
                          color: Colors.textLight,
                        }}
                      >
                        Ref: {payment.paynow_reference}
                      </Text>
                    )}
                  </View>

                  {/* Payment method indicator */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingLeft: 48,
                    }}
                  >
                    {payment.payment_method === 'stripe' ? (
                      <>
                        <Ionicons
                          name="card-outline"
                          size={12}
                          color={Colors.textLight}
                        />
                        <Text
                          selectable
                          style={{
                            fontFamily: Fonts.regular,
                            fontSize: 12,
                            color: Colors.textLight,
                          }}
                        >
                          Card (Stripe)
                        </Text>
                      </>
                    ) : payment.ecocash_number ? (
                      <>
                        <Ionicons
                          name="phone-portrait-outline"
                          size={12}
                          color={Colors.textLight}
                        />
                        <Text
                          selectable
                          style={{
                            fontFamily: Fonts.regular,
                            fontSize: 12,
                            color: Colors.textLight,
                          }}
                        >
                          EcoCash: {payment.ecocash_number}
                        </Text>
                      </>
                    ) : payment.payment_method === 'card' ? (
                      <>
                        <Ionicons
                          name="card-outline"
                          size={12}
                          color={Colors.textLight}
                        />
                        <Text
                          selectable
                          style={{
                            fontFamily: Fonts.regular,
                            fontSize: 12,
                            color: Colors.textLight,
                          }}
                        >
                          Card (Paynow)
                        </Text>
                      </>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
