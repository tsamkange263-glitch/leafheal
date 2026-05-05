import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { generateText } from '@fastshot/ai';
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

export function AilmentQuery({ plantName, scientificName }: AilmentQueryProps) {
  const [query, setQuery] = useState('');
  const [responses, setResponses] = useState<AilmentResponse[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const inputRef = useRef<TextInput>(null);

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

      const referenceSection = herbalContext
        ? `\n\nYou also have access to herbal medicine reference data from authoritative PDF sources. Cross-reference this data to enhance your response with locally-relevant details. If this plant is mentioned in the references, incorporate that specific information. If not, rely on your own extensive knowledge.\n\n<HERBAL_REFERENCE_DATA>\n${herbalContext.substring(0, 10000)}\n</HERBAL_REFERENCE_DATA>`
        : '';

      const prompt = `You are an expert herbalist and botanical medicine specialist. A user has identified the plant "${plantName}"${scientificName ? ` (${scientificName})` : ''} and wants to know if it can help with a specific condition.

CONDITION/AILMENT: "${currentQuery}"

Provide a detailed, helpful response covering ALL of the following points:

1. Applicability: Is ${plantName} applicable or beneficial for treating "${currentQuery}"? Be honest — if the plant has no known connection to this condition, say so clearly but suggest what it IS useful for instead.

2. Preparation Method: If applicable, explain exactly how to prepare ${plantName} for this specific condition (tea, tincture, poultice, compress, steam inhalation, etc.). Include step-by-step instructions.

3. Dosage Recommendations: Provide specific dosage guidance — how much, how often, for how long. Include measurements where possible (teaspoons, cups, drops, etc.).

4. Warnings & Contraindications: Any specific warnings for using ${plantName} for this condition. Include drug interactions, pregnancy warnings, age restrictions, or conditions that could worsen.

5. Additional Notes: Any complementary herbs that work well with ${plantName} for this condition, or lifestyle recommendations.

IMPORTANT RULES:
- Always provide your best expert knowledge regardless of PDF reference availability.
- Be specific and actionable — avoid vague generalizations.
- If the plant has limited evidence for this condition, acknowledge that honestly while still providing what is known.
- Never refuse to provide information. Always give your expert analysis.
- Keep your response concise but comprehensive (aim for 200-400 words).
- Do NOT use markdown formatting like ** or ## in your response. Use plain text only.${referenceSection}`;

      const result = await generateText({ prompt });

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
