import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { FontMap } from '@/constants/Typography';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { AuthProvider } from '@fastshot/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { StripeProviderWrapper } from '@/components/stripe-provider';

const PENDING_CONFIRMATION_KEY = 'herbscan_pending_email_confirmation';

SplashScreen.preventAutoHideAsync();

// Suppress unhandled promise rejections from orphaned timeout promises in @fastshot/ai.
// The AI gateway server has a 6-second timeout, which triggers retries inside the
// NewellClient. Each retry creates an orphaned Promise.race timeout that fires later
// and rejects without a handler. This listener prevents those from crashing the app.
if (Platform.OS !== 'web') {
  const originalHandler = (global as any).onunhandledrejection;
  (global as any).onunhandledrejection = (event: any) => {
    const reason = event?.reason;
    const message = reason?.message || String(reason || '');
    // Suppress known orphaned timeout rejections from AI gateway
    if (
      message.includes('timeout') ||
      message.includes('6000ms') ||
      message.includes('Request timeout after')
    ) {
      // Silently suppress — these are orphaned promises from Promise.race in @fastshot/ai
      return;
    }
    // Let other unhandled rejections through to the original handler
    if (originalHandler) {
      originalHandler(event);
    }
  };
} else {
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      const message = event?.reason?.message || String(event?.reason || '');
      if (
        message.includes('timeout') ||
        message.includes('6000ms') ||
        message.includes('Request timeout after')
      ) {
        event.preventDefault();
      }
    });
  }
}

export default function RootLayout() {
  const [loaded, error] = useFonts(FontMap);
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Handle native email confirmation: if pending flag is set when user signs in,
  // it means they clicked the email confirmation link which auto-signed them in.
  // Sign them out and redirect to login with success message.
  const handleSignIn = useCallback(async () => {
    if (Platform.OS === 'web') return; // Web handled by callback page

    const pending = await AsyncStorage.getItem(PENDING_CONFIRMATION_KEY);
    if (pending === 'true') {
      await AsyncStorage.removeItem(PENDING_CONFIRMATION_KEY);
      await supabase.auth.signOut();
      // Small delay to let auth state settle before navigation
      setTimeout(() => {
        router.replace('/(auth)/login?confirmed=true');
      }, 100);
    }
  }, [router]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <AuthProvider
      supabaseClient={supabase}
      routes={{
        login: '/(auth)/login',
        afterLogin: '/(tabs)',
      }}
      onSignIn={handleSignIn}
    >
      <StripeProviderWrapper>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#F1F8E9' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="scan"
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="result"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="topup"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="payment-history"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="help-support"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="about"
            options={{ animation: 'slide_from_right' }}
          />
        </Stack>
      </StripeProviderWrapper>
    </AuthProvider>
  );
}
