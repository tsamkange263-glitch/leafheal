import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const insets = useSafeAreaInsets();
  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    isLoading,
    error,
    clearError,
  } = useAuth();

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    if (isRegister && !fullName.trim()) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }

    try {
      if (isRegister) {
        const result = await signUpWithEmail(email.trim(), password, {
          data: { full_name: fullName.trim() },
        });
        if (result?.emailConfirmationRequired) {
          Alert.alert(
            'Check Your Email',
            `We sent a verification link to ${email}. Please verify before signing in.`
          );
          setIsRegister(false);
        }
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Authentication failed';
      Alert.alert('Error', msg);
    }
  };

  const toggleMode = () => {
    clearError();
    setIsRegister(!isRegister);
  };

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

        {error && (
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
