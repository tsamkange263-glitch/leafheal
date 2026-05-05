import { useState, useRef } from 'react';
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
import { getHerbalReferenceContext } from '@/lib/herbal-reference';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

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
  herbalContext?: string
): string {
  const plantRef = scientificName
    ? `${plantName} (${scientificName})`
    : plantName;

  // Keep reference data short to avoid exceeding API prompt limits
  const referenceSection = herbalContext
    ? `\n\nHerbal reference data (use to enhance your response if relevant):\n${herbalContext.substring(0, 3000)}`
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
  const inputRef = useRef<TextInput>(null);
  const { generateText } = useTextGeneration();

  const handleSubmitQuery = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isQuerying) return;

    setIsQuerying(true);
    const currentQuery = trimmedQuery;
    setQuery('');

    try {
      // Get herbal reference context for cross-referencing
      let herbalContext = '';
      try {
        herbalContext = await getHerbalReferenceContext();
      } catch {
        // Continue without reference data
      }

      // Build prompt with herbal context (kept short to avoid 422 validation errors)
      const prompt = buildPrompt(plantName, scientificName, currentQuery, herbalContext);

      // Use the hook's generateText which takes prompt string directly
      let result = await generateText(prompt, { temperature: 0.7 });

      // Fallback: retry without herbal context if first attempt fails
      if (!result && herbalContext) {
        const fallbackPrompt = buildPrompt(plantName, scientificName, currentQuery);
        result = await generateText(fallbackPrompt, { temperature: 0.7 });
      }

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
    } catch (error) {
      console.error('Ailment query error:', error);

      // If first attempt failed, try a minimal prompt as last resort
      try {
        const minimalPrompt = sanitizeForPrompt(
          `Describe how the plant "${plantName}" can help with "${currentQuery}". Include preparation, dosage, and warnings. Plain text only, no markdown. 200 words max.`
        );
        const fallbackResult = await generateText(minimalPrompt, { temperature: 0.7 });

        if (fallbackResult) {
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

      const errorResponse: AilmentResponse = {
        id: `${Date.now()}-error`,
        ailment: currentQuery,
        response: 'Unable to generate a response at this time. Please check your connection and try again.',
        timestamp: new Date(),
        isError: true,
      };
      setResponses(prev => [errorResponse, ...prev]);
    } finally {
      setIsQuerying(false);
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

      {/* Loading indicator */}
      {isQuerying && (
        <Animated.View
          entering={FadeIn.duration(300)}
          style={{
            backgroundColor: Colors.card,
            borderRadius: 16,
            borderCurve: 'continuous',
            padding: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}
        >
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
