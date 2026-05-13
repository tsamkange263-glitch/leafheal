import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useTextGeneration } from '@fastshot/ai';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { getTargetedPlantReference } from '@/lib/herbal-reference';
import { logError } from '@/lib/error-utils';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

const AILMENT_QUERY_TIMEOUT_MS = 90000; // 90 seconds — AI gateway has 6s server timeout + retries with backoff

interface AilmentResponse {
  id: string;
  ailment: string;
  response: string;
  timestamp: Date;
  isError?: boolean;
}

interface AilmentQueryProps {
  plantName: string;
  scientificName: string | null;
}

// Safe wrapper for generateText that prevents orphaned promise rejections.
// The @fastshot/ai client uses Promise.race internally which can leave
// unhandled rejections from orphaned timeout promises.
function safeGenerateText(
  generateText: (prompt: string, options?: any) => Promise<string | null>,
  prompt: string,
  options?: any
): Promise<string | null> {
  try {
    const promise = generateText(prompt, options);
    promise.catch(() => {});
    return promise;
  } catch {
    return Promise.resolve(null);
  }
}

// Sanitize text to remove control characters and ensure clean content for API
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars (keep \n, \r, \t)
    .replace(/�/g, '') // Remove replacement characters
    .replace(/\0/g, '') // Remove null bytes
    .trim();
}

// Build a concise prompt that stays within API limits
function buildPrompt(
  plantName: string,
  scientificName: string | null,
  condition: string,
  targetedReference?: string
): string {
  const plantRef = scientificName
    ? `${plantName} (${scientificName})`
    : plantName;

  // Only include targeted reference data for this specific plant (much smaller than full DB)
  const referenceSection = targetedReference
    ? `\n\nRelevant herbal reference excerpts for ${plantName}:\n${targetedReference.substring(0, 2000)}`
    : '';

  return sanitizeForPrompt(
    `You are an expert herbalist. A user identified the plant "${plantRef}" and wants to know if it helps with: "${condition}"

Respond with these sections (plain text only, no markdown):

1. Applicability: Is ${plantName} beneficial for "${condition}"? If not connected, say so and suggest what it IS useful for.
2. Preparation: How to prepare ${plantName} for this condition (tea, tincture, poultice, etc.) with step-by-step instructions.
3. Dosage: Specific amounts, frequency, and duration.
4. Warnings: Drug interactions, pregnancy warnings, age restrictions, contraindications.
5. Additional Notes: Complementary herbs or lifestyle recommendations.

Be specific and actionable. If evidence is limited, acknowledge honestly. Aim for 200-350 words.${referenceSection}`
  );
}

export function AilmentQuery({ plantName, scientificName }: AilmentQueryProps) {
  const [query, setQuery] = useState('');
  const [responses, setResponses] = useState<AilmentResponse[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [showCancelHint, setShowCancelHint] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const { generateText } = useTextGeneration();

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    };
  }, []);

  // Helper: wrap a promise with timeout that properly handles cleanup
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Request timed out after ${ms / 1000} seconds`));
        }
      }, ms);
      promise
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }

  const handleCancelQuery = () => {
    cancelledRef.current = true;
    setIsQuerying(false);
    setShowCancelHint(false);
    if (cancelTimerRef.current) {
      clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }
  };

  const handleSubmitQuery = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isQuerying) return;

    setIsQuerying(true);
    setShowCancelHint(false);
    cancelledRef.current = false;
    const currentQuery = trimmedQuery;
    setQuery('');

    // Show cancel hint after 10 seconds
    cancelTimerRef.current = setTimeout(() => {
      setShowCancelHint(true);
    }, 10000);

    try {
      // Get targeted reference data for this specific plant (much faster than full DB)
      let targetedReference = '';
      try {
        targetedReference = await getTargetedPlantReference(plantName, scientificName);
      } catch {
        // Continue without reference data
      }

      if (cancelledRef.current) return;

      // Build prompt with targeted reference context
      const prompt = buildPrompt(plantName, scientificName, currentQuery, targetedReference);

      // Use the hook's generateText with timeout (wrapped safely to avoid orphaned rejections)
      let result = await withTimeout(
        safeGenerateText(generateText, prompt, { temperature: 0.7 }),
        AILMENT_QUERY_TIMEOUT_MS
      );

      if (cancelledRef.current) return;

      // Fallback: retry without reference if first attempt fails
      if (!result && targetedReference) {
        const fallbackPrompt = buildPrompt(plantName, scientificName, currentQuery);
        result = await withTimeout(
          safeGenerateText(generateText, fallbackPrompt, { temperature: 0.7 }),
          AILMENT_QUERY_TIMEOUT_MS
        );
      }

      if (cancelledRef.current) return;

      if (result) {
        const newResponse: AilmentResponse = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ailment: currentQuery,
          response: result,
          timestamp: new Date(),
        };
        setResponses(prev => [newResponse, ...prev]);
      } else {
        throw new Error('No response received from AI');
      }
    } catch (error: unknown) {
      if (cancelledRef.current) return;
      logError('[ailment-query] Query error', error);

      const isTimeout = error instanceof Error && error.message?.includes('timed out');

      // If timed out or first attempt failed, try a minimal prompt as last resort
      if (!isTimeout) {
        try {
          const minimalPrompt = sanitizeForPrompt(
            `Describe how the plant "${plantName}" can help with "${currentQuery}". Include preparation, dosage, and warnings. Plain text only, no markdown. 200 words max.`
          );
          const fallbackResult = await withTimeout(
            safeGenerateText(generateText, minimalPrompt, { temperature: 0.7 }),
            AILMENT_QUERY_TIMEOUT_MS
          );

          if (fallbackResult && !cancelledRef.current) {
            const newResponse: AilmentResponse = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              ailment: currentQuery,
              response: fallbackResult,
              timestamp: new Date(),
            };
            setResponses(prev => [newResponse, ...prev]);
            return;
          }
        } catch {
          // Final fallback also failed, show error
        }
      }

      if (cancelledRef.current) return;

      const errorResponse: AilmentResponse = {
        id: `${Date.now()}-error`,
        ailment: currentQuery,
        response: isTimeout
          ? 'The request took too long to process. Please try again — a shorter, more specific query may help.'
          : 'Unable to generate a response at this time. Please check your connection and try again.',
        timestamp: new Date(),
        isError: true,
      };
      setResponses(prev => [errorResponse, ...prev]);
    } finally {
      setIsQuerying(false);
      setShowCancelHint(false);
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
      }
    }
  };

  const handleChipPress = (suggestion: string) => {
    if (isQuerying) return;
    setQuery(suggestion);
    inputRef.current?.focus();
  };

  return (
    <View style={{ gap: 16 }}>
      {/* Section Header */}
      <View
        style={{
          backgroundColor: Colors.card,
          borderRadius: 18,
          borderCurve: 'continuous',
          padding: 20,
          gap: 14,
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(46,125,50,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.textPrimary,
              }}
            >
              Ask About a Condition
            </Text>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: Colors.textSecondary,
                marginTop: 1,
              }}
            >
              Find out if {plantName} can help with a specific ailment
            </Text>
          </View>
        </View>

        {/* Input field */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: Colors.background,
            borderRadius: 14,
            borderCurve: 'continuous',
            paddingHorizontal: 14,
            paddingVertical: 4,
            borderWidth: 1.5,
            borderColor: isQuerying ? Colors.primary : Colors.border,
          }}
        >
          <Ionicons name="medical-outline" size={18} color={Colors.textSecondary} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. headache, diabetes, stomach ulcer..."
            placeholderTextColor={Colors.textLight}
            style={{
              flex: 1,
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: Colors.textPrimary,
              paddingVertical: 12,
            }}
            onSubmitEditing={handleSubmitQuery}
            returnKeyType="search"
            editable={!isQuerying}
            autoCapitalize="none"
            autoCorrect
          />
          <Pressable
            onPress={handleSubmitQuery}
            disabled={!query.trim() || isQuerying}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 12,
              borderCurve: 'continuous',
              backgroundColor: query.trim() && !isQuerying
                ? Colors.primary
                : 'rgba(46,125,50,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed && query.trim() && !isQuerying ? 0.8 : 1,
            })}
          >
            {isQuerying ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons
                name="arrow-forward"
                size={18}
                color={query.trim() ? Colors.white : Colors.textLight}
              />
            )}
          </Pressable>
        </View>

        {/* Quick suggestion chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 2 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {['Headache', 'Cold & Flu', 'Stomach pain', 'Inflammation', 'Insomnia', 'Skin rash'].map(
            (suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => handleChipPress(suggestion)}
                disabled={isQuerying}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: pressed
                    ? 'rgba(46,125,50,0.15)'
                    : 'rgba(46,125,50,0.06)',
                  borderWidth: 1,
                  borderColor: 'rgba(46,125,50,0.15)',
                  opacity: isQuerying ? 0.5 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: Fonts.medium,
                    fontSize: 12,
                    color: Colors.primary,
                  }}
                >
                  {suggestion}
                </Text>
              </Pressable>
            )
          )}
        </ScrollView>
      </View>

      {/* Loading indicator with cancel option */}
      {isQuerying && (
        <Animated.View
          entering={FadeIn.duration(300)}
          style={{
            backgroundColor: Colors.card,
            borderRadius: 16,
            borderCurve: 'continuous',
            padding: 20,
            gap: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text
              style={{
                fontFamily: Fonts.medium,
                fontSize: 13,
                color: Colors.textSecondary,
                flex: 1,
              }}
            >
              Analyzing if {plantName} can help with this condition...
            </Text>
          </View>
          {showCancelHint && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 12,
                  color: Colors.textLight,
                }}
              >
                Taking longer than expected...
              </Text>
              <Pressable
                onPress={handleCancelQuery}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: pressed ? 'rgba(211,47,47,0.15)' : 'rgba(211,47,47,0.08)',
                  borderWidth: 1,
                  borderColor: 'rgba(211,47,47,0.2)',
                })}
              >
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 12,
                    color: Colors.error,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </Animated.View>
      )}

      {/* Responses */}
      {responses.map((item, index) => (
        <Animated.View
          key={item.id}
          entering={FadeInDown.delay(index === 0 ? 0 : 100).duration(400)}
          style={{
            backgroundColor: Colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {/* Response header */}
          <View
            style={{
              backgroundColor: item.isError
                ? 'rgba(211,47,47,0.06)'
                : 'rgba(46,125,50,0.06)',
              paddingHorizontal: 18,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderBottomWidth: 1,
              borderBottomColor: item.isError
                ? 'rgba(211,47,47,0.08)'
                : 'rgba(46,125,50,0.08)',
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: item.isError ? Colors.error : Colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={item.isError ? 'alert-circle' : 'medical'}
                size={15}
                color={Colors.white}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 14,
                  color: Colors.textPrimary,
                  textTransform: 'capitalize',
                }}
              >
                {item.ailment}
              </Text>
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 11,
                  color: Colors.textSecondary,
                }}
              >
                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>

          {/* Response body */}
          <View style={{ padding: 18 }}>
            <Text
              selectable
              style={{
                fontFamily: Fonts.regular,
                fontSize: 14,
                color: item.isError ? Colors.error : Colors.textPrimary,
                lineHeight: 22,
              }}
            >
              {cleanResponse(item.response)}
            </Text>
          </View>

          {/* Disclaimer footer - only for successful responses */}
          {!item.isError && (
            <View
              style={{
                backgroundColor: 'rgba(255,111,0,0.05)',
                paddingHorizontal: 18,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="information-circle-outline" size={14} color={Colors.warning} />
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 11,
                  color: Colors.warning,
                  flex: 1,
                }}
              >
                For educational purposes only. Consult a healthcare professional before use.
              </Text>
            </View>
          )}
        </Animated.View>
      ))}
    </View>
  );
}

// Helper to clean up markdown-style formatting from AI response
function cleanResponse(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,3}\s/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
}
