import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthCallbackPage } from '@fastshot/auth';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';

const PENDING_CONFIRMATION_KEY = 'herbscan_pending_email_confirmation';

/**
 * Auth callback handler for web.
 * Handles both OAuth sign-in callbacks and email confirmation callbacks.
 *
 * Detection strategy:
 * - On registration, we store a flag in AsyncStorage
 * - When callback fires, if flag is present → it's email confirmation
 * - Clear the flag and redirect to login with confirmed=true
 */
export default function Callback() {
  const router = useRouter();
  const [isEmailConfirmation, setIsEmailConfirmation] = useState<boolean | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Check if user was pending email confirmation
    AsyncStorage.getItem(PENDING_CONFIRMATION_KEY).then((value) => {
      setIsEmailConfirmation(value === 'true');
    });
  }, []);

  // Wait until we know whether this is email confirmation or OAuth
  if (isEmailConfirmation === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F1F8E9', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 16, fontFamily: Fonts.regular, fontSize: 15, color: Colors.textSecondary }}>
          Verifying...
        </Text>
      </View>
    );
  }

  return (
    <AuthCallbackPage
      supabaseClient={supabase}
      onSuccess={async () => {
        if (isEmailConfirmation) {
          // Clear the pending flag
          await AsyncStorage.removeItem(PENDING_CONFIRMATION_KEY);
          // Sign out — user should explicitly log in after confirming
          await supabase.auth.signOut();
          router.replace('/(auth)/login?confirmed=true');
        } else {
          // OAuth sign-in — go straight to app
          router.replace('/(tabs)');
        }
      }}
      onError={(error) => {
        AsyncStorage.removeItem(PENDING_CONFIRMATION_KEY);
        router.replace(
          `/(auth)/login?error=${encodeURIComponent(error.message)}`
        );
      }}
      loadingText={isEmailConfirmation ? 'Confirming your email...' : 'Completing sign in...'}
    />
  );
}
