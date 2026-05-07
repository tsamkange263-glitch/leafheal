import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@fastshot/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';

const PENDING_CONFIRMATION_KEY = 'herbscan_pending_email_confirmation';

export default function LoginScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailNotConfirmedError, setEmailNotConfirmedError] = useState(false);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ confirmed?: string; error?: string }>();

  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    isLoading,
    error,
    clearError,
  } = useAuth();

  // Handle redirect params (email confirmed success or error from callback)
  useEffect(() => {
    if (params.confirmed === 'true') {
      setSuccessMessage('Email confirmed! You can now log in.');
      // Clear pending confirmation flag
      AsyncStorage.removeItem(PENDING_CONFIRMATION_KEY);
      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => setSuccessMessage(null), 8000);
      return () => clearTimeout(timer);
    }
    if (params.error) {
      // Error passed from auth callback
      setSuccessMessage(null);
    }
  }, [params.confirmed, params.error]);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      return;
    }
    if (isRegister && !fullName.trim()) {
      return;
    }

    setEmailNotConfirmedError(false);
    setSuccessMessage(null);

    try {
      if (isRegister) {
        const result = await signUpWithEmail(email.trim(), password, {
          data: { full_name: fullName.trim() },
        });
        if (result?.emailConfirmationRequired) {
          // Store flag so callback page knows this is email confirmation, not OAuth
          await AsyncStorage.setItem(PENDING_CONFIRMATION_KEY, 'true');
          setConfirmationEmail(email.trim());
          setConfirmationSent(true);
        }
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Authentication failed';
      // Detect unconfirmed email error from Supabase
      if (
        msg.toLowerCase().includes('email not confirmed') ||
        msg.toLowerCase().includes('email_not_confirmed')
      ) {
        setEmailNotConfirmedError(true);
      }
    }
  };

  const toggleMode = () => {
    clearError();
    setIsRegister(!isRegister);
    setConfirmationSent(false);
    setEmailNotConfirmedError(false);
    setSuccessMessage(null);
  };

  // Email confirmation sent screen
  if (confirmationSent) {
    return (
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#F1F8E9',
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: 'rgba(46,125,50,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Ionicons name="mail-outline" size={40} color={Colors.primary} />
        </View>

        <Text
          style={{
            fontFamily: Fonts.extraBold,
            fontSize: 24,
            color: Colors.textPrimary,
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          Check Your Email
        </Text>

        <Text
          style={{
            fontFamily: Fonts.regular,
            fontSize: 15,
            color: Colors.textSecondary,
            textAlign: 'center',
            lineHeight: 22,
            maxWidth: 320,
            marginBottom: 8,
          }}
        >
          A confirmation link has been sent to
        </Text>

        <Text
          style={{
            fontFamily: Fonts.bold,
            fontSize: 15,
            color: Colors.textPrimary,
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          {confirmationEmail}
        </Text>

        <View
          style={{
            backgroundColor: 'rgba(46,125,50,0.06)',
            borderRadius: 14,
            borderCurve: 'continuous',
            padding: 16,
            marginBottom: 32,
            width: '100%',
            maxWidth: 340,
          }}
        >
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            Please check your inbox and click the link to verify your account. You may need to check
            your spam folder.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            setConfirmationSent(false);
            setIsRegister(false);
            clearError();
            // Don't clear the AsyncStorage flag here — user might still click the email link
          }}
          style={({ pressed }) => ({
            paddingVertical: 14,
            paddingHorizontal: 32,
            backgroundColor: Colors.primary,
            borderRadius: 14,
            borderCurve: 'continuous',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 15,
              color: Colors.white,
            }}
          >
            Back to Login
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setConfirmationSent(false);
          }}
          style={{ marginTop: 16 }}
        >
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 13,
              color: Colors.textLight,
            }}
          >
            {"Didn't receive it? Try registering again"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 36 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: 'rgba(46,125,50,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <Ionicons name="leaf" size={36} color={Colors.primary} />
          </View>
          <Text
            style={{
              fontFamily: Fonts.extraBold,
              fontSize: 28,
              color: Colors.primary,
              letterSpacing: -0.5,
            }}
          >
            HerbScan
          </Text>
        </View>

        {/* Success Banner (email confirmed) */}
        {successMessage && (
          <View
            style={{
              backgroundColor: 'rgba(46,125,50,0.08)',
              borderRadius: 12,
              borderCurve: 'continuous',
              padding: 14,
              marginBottom: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderWidth: 1,
              borderColor: 'rgba(46,125,50,0.15)',
            }}
          >
            <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 14,
                color: Colors.primary,
                flex: 1,
              }}
            >
              {successMessage}
            </Text>
            <Pressable onPress={() => setSuccessMessage(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={Colors.primary} />
            </Pressable>
          </View>
        )}

        {/* Toggle */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: Colors.card,
            borderRadius: 14,
            borderCurve: 'continuous',
            padding: 4,
            marginBottom: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          {['Login', 'Register'].map((label, i) => {
            const active = i === 0 ? !isRegister : isRegister;
            return (
              <Pressable
                key={label}
                onPress={() => (i === 0 ? setIsRegister(false) : setIsRegister(true))}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 11,
                  borderCurve: 'continuous',
                  backgroundColor: active ? Colors.primary : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 15,
                    color: active ? Colors.white : Colors.textSecondary,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Form */}
        <View style={{ gap: 14 }}>
          {isRegister && (
            <View>
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 13,
                  color: Colors.textSecondary,
                  marginBottom: 6,
                  marginLeft: 4,
                }}
              >
                Full Name
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: Colors.card,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  borderWidth: 1.5,
                  borderColor: Colors.border,
                  paddingHorizontal: 14,
                }}
              >
                <Ionicons name="person-outline" size={18} color={Colors.textLight} />
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your full name"
                  placeholderTextColor={Colors.textLight}
                  autoCapitalize="words"
                  style={{
                    flex: 1,
                    fontFamily: Fonts.regular,
                    fontSize: 15,
                    color: Colors.textPrimary,
                    paddingVertical: 14,
                    paddingLeft: 10,
                  }}
                />
              </View>
            </View>
          )}

          <View>
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 13,
                color: Colors.textSecondary,
                marginBottom: 6,
                marginLeft: 4,
              }}
            >
              Email Address
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: Colors.card,
                borderRadius: 14,
                borderCurve: 'continuous',
                borderWidth: 1.5,
                borderColor: Colors.border,
                paddingHorizontal: 14,
              }}
            >
              <Ionicons name="mail-outline" size={18} color={Colors.textLight} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textLight}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                style={{
                  flex: 1,
                  fontFamily: Fonts.regular,
                  fontSize: 15,
                  color: Colors.textPrimary,
                  paddingVertical: 14,
                  paddingLeft: 10,
                }}
              />
            </View>
          </View>

          <View>
            <Text
              style={{
                fontFamily: Fonts.semiBold,
                fontSize: 13,
                color: Colors.textSecondary,
                marginBottom: 6,
                marginLeft: 4,
              }}
            >
              Password
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: Colors.card,
                borderRadius: 14,
                borderCurve: 'continuous',
                borderWidth: 1.5,
                borderColor: Colors.border,
                paddingHorizontal: 14,
              }}
            >
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textLight} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Min 6 characters"
                placeholderTextColor={Colors.textLight}
                secureTextEntry={!showPassword}
                autoComplete="password"
                style={{
                  flex: 1,
                  fontFamily: Fonts.regular,
                  fontSize: 15,
                  color: Colors.textPrimary,
                  paddingVertical: 14,
                  paddingLeft: 10,
                }}
              />
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={8}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={Colors.textLight}
                />
              </Pressable>
            </View>
          </View>

          {!isRegister && (
            <Pressable style={{ alignSelf: 'flex-end' }}>
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 13,
                  color: Colors.primary,
                }}
              >
                Forgot Password?
              </Text>
            </Pressable>
          )}
        </View>

        {/* Email not confirmed warning */}
        {emailNotConfirmedError && (
          <View
            style={{
              backgroundColor: 'rgba(245,158,11,0.08)',
              borderRadius: 12,
              borderCurve: 'continuous',
              padding: 14,
              marginTop: 14,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              borderWidth: 1,
              borderColor: 'rgba(245,158,11,0.2)',
            }}
          >
            <Ionicons name="warning" size={20} color="#F59E0B" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 14,
                  color: '#92400E',
                  marginBottom: 4,
                }}
              >
                Email not verified
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 13,
                  color: '#92400E',
                  lineHeight: 18,
                }}
              >
                Please check your inbox for the confirmation link and verify your email address
                before logging in.
              </Text>
            </View>
          </View>
        )}

        {/* General error (not email confirmation) */}
        {error && !emailNotConfirmedError && (
          <View
            style={{
              backgroundColor: 'rgba(211,47,47,0.08)',
              borderRadius: 10,
              padding: 12,
              marginTop: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text
              selectable
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: Colors.error,
                flex: 1,
              }}
            >
              {error.message}
            </Text>
          </View>
        )}

        {/* Submit */}
        <Pressable
          onPress={handleSubmit}
          disabled={isLoading}
          style={({ pressed }) => ({
            backgroundColor: Colors.primary,
            paddingVertical: 16,
            borderRadius: 14,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 20,
            opacity: isLoading ? 0.7 : pressed ? 0.9 : 1,
          })}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.white,
              }}
            >
              {isRegister ? 'Create Account' : 'Login'}
            </Text>
          )}
        </Pressable>

        {/* Divider */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginVertical: 20,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 13,
              color: Colors.textLight,
            }}
          >
            or
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
        </View>

        {/* Google */}
        <Pressable
          onPress={signInWithGoogle}
          disabled={isLoading}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            backgroundColor: Colors.card,
            paddingVertical: 14,
            borderRadius: 14,
            borderCurve: 'continuous',
            borderWidth: 1.5,
            borderColor: Colors.border,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Ionicons name="logo-google" size={20} color="#4285F4" />
          <Text
            style={{
              fontFamily: Fonts.semiBold,
              fontSize: 15,
              color: Colors.textPrimary,
            }}
          >
            Continue with Google
          </Text>
        </Pressable>

        {/* Footer */}
        <Pressable
          onPress={toggleMode}
          style={{ marginTop: 24, alignItems: 'center' }}
        >
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textSecondary,
            }}
          >
            {isRegister
              ? 'Already have an account? '
              : "Don't have an account? "}
            <Text
              style={{
                fontFamily: Fonts.bold,
                color: Colors.primary,
              }}
            >
              {isRegister ? 'Login' : 'Register'}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
