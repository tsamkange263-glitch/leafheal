import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useAuth } from '@fastshot/auth';
import { useTextGeneration } from '@fastshot/ai';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { AilmentQuery } from '@/components/ailment-query';
import { getTargetedPlantReference } from '@/lib/herbal-reference';
import type { Tables, RemedyData, PlantHealthData } from '@/lib/types';
import type { PlantNetResult } from '@/lib/plantnet';
import Animated, { FadeInDown } from 'react-native-reanimated';

type TabKey = 'overview' | 'remedies' | 'precautions' | 'plant_health';

const REMEDY_TIMEOUT_MS = 30000;

// Helper: wrap a promise with a timeout
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000} seconds`));
    }, ms);
    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

export default function ResultScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { archivedIds, addArchivedId, removeArchivedId } = useAppStore();

  // Params: either from fresh scan (topResults + imageUrl) or from archive (scanId)
  const params = useLocalSearchParams<{
    scanId?: string;
    imageUrl?: string;
    localImageUri?: string;
    topResults?: string;
  }>();

  const { generateText } = useTextGeneration();

  // State for fresh identification flow
  const [topResults, setTopResults] = useState<PlantNetResult[]>([]);
  const [userImageUrl, setUserImageUrl] = useState<string>('');
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // State for existing scan (from archive or after selection)
  const [scan, setScan] = useState<Tables<'scans'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [archiving, setArchiving] = useState(false);

  // Mode: 'selection' for fresh scan, 'detail' for viewing saved scan
  const [mode, setMode] = useState<'selection' | 'detail'>('selection');

  const scanId = scan?.id || params.scanId;
  const isArchived = scanId ? archivedIds.includes(scanId) : false;

  // Parse topResults from params on mount
  useEffect(() => {
    if (params.topResults) {
      try {
        const parsed = JSON.parse(params.topResults) as PlantNetResult[];
        setTopResults(parsed);
        setUserImageUrl(params.imageUrl || params.localImageUri || '');
        setMode('selection');
        setLoading(false);
      } catch {
        setLoading(false);
      }
    } else if (params.scanId) {
      setMode('detail');
      fetchScan(params.scanId);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchScan = useCallback(async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('scans')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setScan(data);
      setUserImageUrl(data.image_url || '');
      setMode('detail');
    } catch (e) {
      console.error('Error fetching scan:', e);
      Alert.alert('Error', 'Failed to load scan result');
    } finally {
      setLoading(false);
    }
  }, []);

  // Check if archived
  useEffect(() => {
    if (!scanId || !user?.id) return;
    supabase
      .from('archived_remedies')
      .select('id')
      .eq('user_id', user.id)
      .eq('scan_id', scanId)
      .then(({ data }) => {
        if (data && data.length > 0) {
          addArchivedId(scanId);
        }
      });
  }, [scanId, user?.id]);

  // Handle plant option selection — generate AI content for the chosen plant
  const handleSelectOption = async (index: number) => {
    if (!user?.id) return;
    const chosen = topResults[index];
    if (!chosen) return;

    setSelectedOption(index);
    setGenerating(true);
    setGenerationError(null);

    try {
      // Get targeted reference from herbal PDFs
      const targetedReference = await getTargetedPlantReference(chosen.plantName, chosen.scientificName);

      const referenceSection = targetedReference
        ? `\n\nRelevant herbal reference excerpts for ${chosen.plantName}:\n${targetedReference}\n\nUse the above reference data to enrich your response with specific preparation methods, dosages, and traditional uses. If the data doesn't match this plant, rely on your own knowledge.`
        : '';

      const enrichmentPrompt = `You are an expert botanist and herbalist. For the plant "${chosen.plantName}" (Scientific: ${chosen.scientificName}, Family: ${chosen.family}, Genus: ${chosen.genus}), provide comprehensive information.

Respond ONLY with valid JSON:
{
  "overview": "A detailed 2-3 sentence description of the plant including its family, habitat, and distinguishing features.",
  "remedies": {
    "uses": "Main medicinal/herbal uses (2-3 sentences)",
    "preparation": "How to prepare as a remedy - tea, poultice, tincture, etc. Include specific methods.",
    "dosage": "Recommended dosage and frequency with specific measurements",
    "benefits": "Key health benefits (2-3 items)",
    "traditional_uses": "Traditional medicine uses from various cultures"
  },
  "precautions": "Important warnings, toxicity info, contraindications, and who should avoid this plant.",
  "plant_health": {
    "is_healthy": true,
    "condition_name": "Healthy",
    "symptoms": "No visible symptoms",
    "cause": "N/A",
    "cause_category": "healthy",
    "severity": "none",
    "treatments": {
      "organic": "General organic care tips",
      "chemical": "N/A"
    },
    "prevention_tips": "General prevention tips for common diseases of this species",
    "general_care_tips": "General care tips for this plant including watering, sunlight, and soil preferences"
  }
}${referenceSection}

Provide rich, specific, actionable information. Only return the JSON.`;

      let enrichmentData: any = null;

      try {
        const enrichmentResult = await withTimeout(
          generateText(enrichmentPrompt),
          REMEDY_TIMEOUT_MS,
          'Plant enrichment'
        );

        if (enrichmentResult) {
          const match = enrichmentResult.match(/\{[\s\S]*\}/);
          if (match) {
            enrichmentData = JSON.parse(match[0]);
          }
        }
      } catch (e: any) {
        console.error('Enrichment error:', e);
        enrichmentData = {
          overview: `${chosen.plantName} (${chosen.scientificName}) is a member of the ${chosen.family} family. It belongs to the genus ${chosen.genus}.`,
          remedies: {
            uses: `${chosen.plantName} has various traditional medicinal uses. Further research is recommended.`,
            preparation: 'Consult a qualified herbalist for preparation methods.',
            dosage: 'Dosage varies by preparation method. Consult a healthcare professional.',
            benefits: 'This plant has been used in traditional medicine.',
            traditional_uses: 'Used in various folk medicine traditions.',
          },
          precautions: 'Always consult a healthcare professional before using any plant medicinally.',
          plant_health: {
            is_healthy: true,
            condition_name: 'Healthy',
            symptoms: 'No visible symptoms',
            cause: 'N/A',
            cause_category: 'healthy',
            severity: 'none',
            treatments: { organic: 'General organic care', chemical: 'N/A' },
            prevention_tips: 'Ensure proper watering and sunlight.',
            general_care_tips: 'Research specific care requirements for this species.',
          },
        };
      }

      // Save scan to database
      const { data: scanData, error: insertErr } = await supabase
        .from('scans')
        .insert({
          user_id: user.id,
          image_url: userImageUrl || null,
          plant_name: chosen.plantName || 'Unknown Plant',
          scientific_name: chosen.scientificName || null,
          confidence: chosen.confidence || 0.5,
          overview: enrichmentData?.overview || null,
          remedies: enrichmentData?.remedies || null,
          precautions: enrichmentData?.precautions || null,
          plant_health: enrichmentData?.plant_health || null,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setScan(scanData);
      setMode('detail');
    } catch (e: any) {
      console.error('Selection error:', e);
      setGenerationError('Failed to generate plant information. Tap to retry.');
      setSelectedOption(null);
    } finally {
      setGenerating(false);
    }
  };

  const toggleArchive = async () => {
    if (!scan || !user?.id || !scan.id) return;
    setArchiving(true);

    try {
      if (isArchived) {
        await supabase
          .from('archived_remedies')
          .delete()
          .eq('user_id', user.id)
          .eq('scan_id', scan.id);
        removeArchivedId(scan.id);
      } else {
        await supabase.from('archived_remedies').insert({
          user_id: user.id,
          scan_id: scan.id,
        });
        addArchivedId(scan.id);
      }
    } catch (e) {
      console.error('Archive toggle error:', e);
      Alert.alert('Error', 'Failed to update archive');
    } finally {
      setArchiving(false);
    }
  };

  const remedies: RemedyData | null = scan?.remedies
    ? (scan.remedies as unknown as RemedyData)
    : null;

  const plantHealth: PlantHealthData | null = scan?.plant_health
    ? (scan.plant_health as unknown as PlantHealthData)
    : null;

  const confidencePercent = scan?.confidence
    ? Math.round(scan.confidence * 100)
    : 0;

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: 'leaf' },
    { key: 'remedies', label: 'Herbal Remedies', icon: 'medkit' },
    { key: 'precautions', label: 'Precautions', icon: 'warning' },
    { key: 'plant_health', label: 'Plant Health', icon: 'fitness' },
  ];

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text
          style={{
            fontFamily: Fonts.semiBold,
            fontSize: 15,
            color: Colors.textSecondary,
            marginTop: 12,
          }}
        >
          Loading result...
        </Text>
      </View>
    );
  }

  // ============================================================
  // SELECTION MODE: Show top 2 results for user to choose
  // ============================================================
  if (mode === 'selection' && topResults.length > 0) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* User's captured photo as hero image */}
          <View style={{ height: 260, backgroundColor: Colors.primaryDark }}>
            {userImageUrl ? (
              <Image
                source={{ uri: userImageUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: Colors.primary,
                }}
              >
                <Ionicons name="leaf" size={64} color="rgba(255,255,255,0.3)" />
              </View>
            )}

            {/* Gradient overlay */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 120,
                backgroundColor: 'transparent',
              }}
            >
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.0)' }} />
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' }} />
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
            </View>

            {/* Back button */}
            <Pressable
              onPress={() => router.back()}
              style={{
                position: 'absolute',
                top: insets.top + 8,
                left: 16,
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.4)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="arrow-back" size={22} color={Colors.white} />
            </Pressable>

            {/* Your Photo label */}
            <View
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: 'rgba(0,0,0,0.5)',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
              }}
            >
              <Ionicons name="camera" size={14} color={Colors.white} />
              <Text style={{ fontFamily: Fonts.semiBold, fontSize: 12, color: Colors.white }}>
                Your Photo
              </Text>
            </View>
          </View>

          {/* Selection header */}
          <Animated.View
            entering={FadeInDown.duration(500)}
            style={{
              marginTop: -24,
              marginHorizontal: 16,
              backgroundColor: Colors.card,
              borderRadius: 22,
              borderCurve: 'continuous',
              padding: 20,
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: 'rgba(139,195,74,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="search" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: Fonts.extraBold,
                    fontSize: 20,
                    color: Colors.textPrimary,
                  }}
                >
                  Which plant is this?
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 13,
                    color: Colors.textSecondary,
                    marginTop: 2,
                  }}
                >
                  Compare with reference images and select the best match
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Generation error */}
          {generationError && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={{
                marginHorizontal: 16,
                marginTop: 12,
                backgroundColor: 'rgba(211,47,47,0.08)',
                borderRadius: 12,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Ionicons name="alert-circle" size={20} color={Colors.error} />
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 13,
                  color: Colors.error,
                  flex: 1,
                }}
              >
                {generationError}
              </Text>
            </Animated.View>
          )}

          {/* Plant option cards */}
          {topResults.map((result, index) => (
            <Animated.View
              key={index}
              entering={FadeInDown.delay(150 + index * 100).duration(500)}
              style={{
                marginHorizontal: 16,
                marginTop: 16,
              }}
            >
              <Pressable
                onPress={() => !generating && handleSelectOption(index)}
                disabled={generating}
                style={({ pressed }) => ({
                  backgroundColor: Colors.card,
                  borderRadius: 20,
                  borderCurve: 'continuous',
                  overflow: 'hidden',
                  borderWidth: 2,
                  borderColor:
                    selectedOption === index && generating
                      ? Colors.primary
                      : pressed
                      ? Colors.accentLight
                      : Colors.border,
                  opacity: generating && selectedOption !== index ? 0.5 : pressed ? 0.95 : 1,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                })}
              >
                {/* Option header with confidence */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: 16,
                    paddingBottom: 10,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: index === 0 ? Colors.primary : Colors.accent,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: Fonts.bold,
                            fontSize: 12,
                            color: Colors.white,
                          }}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.bold,
                          fontSize: 18,
                          color: Colors.textPrimary,
                          flex: 1,
                        }}
                        numberOfLines={1}
                      >
                        {result.plantName}
                      </Text>
                    </View>
                    <Text
                      selectable
                      style={{
                        fontFamily: Fonts.regular,
                        fontSize: 14,
                        color: Colors.textSecondary,
                        fontStyle: 'italic',
                        paddingLeft: 32,
                      }}
                    >
                      {result.scientificName}
                    </Text>
                  </View>

                  {/* Confidence badge */}
                  <View
                    style={{
                      backgroundColor:
                        result.confidence > 0.5
                          ? 'rgba(46,125,50,0.1)'
                          : result.confidence > 0.25
                          ? 'rgba(255,111,0,0.1)'
                          : 'rgba(211,47,47,0.08)',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Ionicons
                      name="analytics"
                      size={13}
                      color={
                        result.confidence > 0.5
                          ? Colors.primary
                          : result.confidence > 0.25
                          ? Colors.warning
                          : Colors.error
                      }
                    />
                    <Text
                      style={{
                        fontFamily: Fonts.bold,
                        fontSize: 13,
                        fontVariant: ['tabular-nums'],
                        color:
                          result.confidence > 0.5
                            ? Colors.primary
                            : result.confidence > 0.25
                            ? Colors.warning
                            : Colors.error,
                      }}
                    >
                      {Math.round(result.confidence * 100)}%
                    </Text>
                  </View>
                </View>

                {/* Reference images row */}
                {result.referenceImages && result.referenceImages.length > 0 && (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                    <Text
                      style={{
                        fontFamily: Fonts.semiBold,
                        fontSize: 11,
                        color: Colors.textLight,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      Reference Images
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ flexGrow: 0 }}
                      contentContainerStyle={{ gap: 8 }}
                    >
                      {result.referenceImages.map((imgUrl, imgIdx) => (
                        <View
                          key={imgIdx}
                          style={{
                            width: 80,
                            height: 80,
                            borderRadius: 12,
                            borderCurve: 'continuous',
                            overflow: 'hidden',
                            backgroundColor: Colors.background,
                            borderWidth: 1,
                            borderColor: Colors.border,
                          }}
                        >
                          <Image
                            source={{ uri: imgUrl }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Select button */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingBottom: 16,
                    paddingTop: 4,
                  }}
                >
                  <View
                    style={{
                      backgroundColor:
                        selectedOption === index && generating
                          ? Colors.primaryLight
                          : index === 0
                          ? Colors.primary
                          : Colors.accent,
                      paddingVertical: 12,
                      borderRadius: 12,
                      borderCurve: 'continuous',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 8,
                    }}
                  >
                    {selectedOption === index && generating ? (
                      <>
                        <ActivityIndicator color={Colors.white} size="small" />
                        <Text
                          style={{
                            fontFamily: Fonts.bold,
                            fontSize: 14,
                            color: Colors.white,
                          }}
                        >
                          Generating info...
                        </Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={16} color={Colors.white} />
                        <Text
                          style={{
                            fontFamily: Fonts.bold,
                            fontSize: 14,
                            color: Colors.white,
                          }}
                        >
                          This is my plant
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          ))}

          {/* Tip */}
          <Animated.View
            entering={FadeInDown.delay(400).duration(500)}
            style={{
              marginHorizontal: 16,
              marginTop: 20,
              backgroundColor: 'rgba(139,195,74,0.08)',
              borderRadius: 14,
              borderCurve: 'continuous',
              padding: 14,
              flexDirection: 'row',
              gap: 10,
            }}
          >
            <Ionicons name="bulb-outline" size={18} color={Colors.accent} />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: Colors.textSecondary,
                flex: 1,
                lineHeight: 18,
              }}
            >
              Compare your photo with the reference images above to determine which identification is correct. Higher confidence scores indicate a better match.
            </Text>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // DETAIL MODE: Show full plant information (after selection or from archive)
  // ============================================================
  if (!scan) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 40,
        }}
      >
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text
          style={{
            fontFamily: Fonts.semiBold,
            fontSize: 16,
            color: Colors.textPrimary,
            marginTop: 12,
          }}
        >
          Scan not found
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 16,
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: Colors.primary,
            borderRadius: 10,
          }}
        >
          <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.white }}>
            Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* User's captured photo as hero image */}
        <View style={{ height: 280, backgroundColor: Colors.primaryDark }}>
          {(scan.image_url || userImageUrl) ? (
            <Image
              source={{ uri: scan.image_url || userImageUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: Colors.primary,
              }}
            >
              <Ionicons name="leaf" size={64} color="rgba(255,255,255,0.3)" />
            </View>
          )}

          {/* Gradient overlay */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 100,
              backgroundColor: 'rgba(0,0,0,0.3)',
            }}
          />

          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            style={{
              position: 'absolute',
              top: insets.top + 8,
              left: 16,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(0,0,0,0.4)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </Pressable>

          {/* Confidence badge */}
          <View
            style={{
              position: 'absolute',
              top: insets.top + 8,
              right: 16,
              backgroundColor: 'rgba(0,0,0,0.5)',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Ionicons name="checkmark-circle" size={14} color={Colors.accent} />
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 13,
                color: Colors.white,
                fontVariant: ['tabular-nums'],
              }}
            >
              {confidencePercent}% Confidence
            </Text>
          </View>
        </View>

        {/* Plant name card */}
        <Animated.View
          entering={FadeInDown.duration(500)}
          style={{
            marginTop: -40,
            marginHorizontal: 16,
            backgroundColor: Colors.card,
            borderRadius: 22,
            borderCurve: 'continuous',
            padding: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
        >
          <Text
            selectable
            style={{
              fontFamily: Fonts.extraBold,
              fontSize: 26,
              color: Colors.textPrimary,
            }}
          >
            {scan.plant_name || 'Unknown Plant'}
          </Text>
          {scan.scientific_name && (
            <Text
              selectable
              style={{
                fontFamily: Fonts.regular,
                fontSize: 15,
                color: Colors.textSecondary,
                fontStyle: 'italic',
                marginTop: 2,
              }}
            >
              {scan.scientific_name}
            </Text>
          )}
        </Animated.View>

        {/* Tabs */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={{
            marginHorizontal: 16,
            marginTop: 16,
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              backgroundColor: Colors.card,
              borderRadius: 14,
              borderCurve: 'continuous',
              padding: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              gap: 2,
            }}
          >
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 11,
                  borderCurve: 'continuous',
                  backgroundColor: activeTab === tab.key ? Colors.primary : 'transparent',
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Ionicons
                  name={tab.icon as keyof typeof Ionicons.glyphMap}
                  size={14}
                  color={activeTab === tab.key ? Colors.white : Colors.textSecondary}
                />
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 11,
                    color: activeTab === tab.key ? Colors.white : Colors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Tab content */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(500)}
          style={{
            marginHorizontal: 16,
            marginTop: 16,
          }}
        >
          {activeTab === 'overview' && (
            <View
              style={{
                backgroundColor: Colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
                padding: 20,
                gap: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="leaf" size={20} color={Colors.primary} />
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 17,
                    color: Colors.textPrimary,
                  }}
                >
                  Plant Overview
                </Text>
              </View>
              <Text
                selectable
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 15,
                  color: Colors.textPrimary,
                  lineHeight: 24,
                }}
              >
                {scan.overview || 'No overview available for this plant.'}
              </Text>

              {/* Quick info grid */}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 4,
                }}
              >
                {[
                  {
                    icon: 'analytics-outline' as const,
                    label: 'Confidence',
                    value: `${confidencePercent}%`,
                  },
                  {
                    icon: 'calendar-outline' as const,
                    label: 'Scanned',
                    value: new Date(scan.created_at).toLocaleDateString(),
                  },
                ].map((info, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      minWidth: 140,
                      backgroundColor: Colors.background,
                      borderRadius: 12,
                      borderCurve: 'continuous',
                      padding: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Ionicons name={info.icon} size={18} color={Colors.primary} />
                    <View>
                      <Text
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 11,
                          color: Colors.textSecondary,
                        }}
                      >
                        {info.label}
                      </Text>
                      <Text
                        style={{
                          fontFamily: Fonts.bold,
                          fontSize: 14,
                          color: Colors.textPrimary,
                        }}
                      >
                        {info.value}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {activeTab === 'remedies' && (
            <View
              style={{
                backgroundColor: Colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
                padding: 20,
                gap: 18,
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="medkit" size={20} color={Colors.primary} />
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 17,
                    color: Colors.textPrimary,
                  }}
                >
                  Herbal Remedies
                </Text>
              </View>

              {remedies ? (
                <>
                  {[
                    { label: 'Uses', value: remedies.uses, icon: 'fitness-outline' as const },
                    { label: 'Preparation', value: remedies.preparation, icon: 'flask-outline' as const },
                    { label: 'Dosage', value: remedies.dosage, icon: 'eyedrop-outline' as const },
                    { label: 'Benefits', value: remedies.benefits, icon: 'heart-outline' as const },
                    { label: 'Traditional Uses', value: remedies.traditional_uses, icon: 'globe-outline' as const },
                  ]
                    .filter((item) => item.value)
                    .map((item, i) => (
                      <View key={i} style={{ gap: 6 }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Ionicons name={item.icon} size={16} color={Colors.primary} />
                          <Text
                            style={{
                              fontFamily: Fonts.bold,
                              fontSize: 14,
                              color: Colors.primary,
                            }}
                          >
                            {item.label}
                          </Text>
                        </View>
                        <Text
                          selectable
                          style={{
                            fontFamily: Fonts.regular,
                            fontSize: 14,
                            color: Colors.textPrimary,
                            lineHeight: 22,
                            paddingLeft: 22,
                          }}
                        >
                          {item.value}
                        </Text>
                      </View>
                    ))}
                </>
              ) : (
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 15,
                    color: Colors.textSecondary,
                    textAlign: 'center',
                    paddingVertical: 20,
                  }}
                >
                  No remedy data available for this plant.
                </Text>
              )}
            </View>
          )}

          {activeTab === 'precautions' && (
            <View
              style={{
                backgroundColor: Colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
                padding: 20,
                gap: 12,
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="warning" size={20} color={Colors.warning} />
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 17,
                    color: Colors.textPrimary,
                  }}
                >
                  Precautions & Warnings
                </Text>
              </View>

              {scan.precautions ? (
                <Text
                  selectable
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 15,
                    color: Colors.textPrimary,
                    lineHeight: 24,
                  }}
                >
                  {scan.precautions}
                </Text>
              ) : (
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 15,
                    color: Colors.textSecondary,
                    textAlign: 'center',
                    paddingVertical: 20,
                  }}
                >
                  No precaution data available.
                </Text>
              )}

              {/* Disclaimer */}
              <View
                style={{
                  backgroundColor: 'rgba(255,111,0,0.08)',
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  padding: 14,
                  flexDirection: 'row',
                  gap: 10,
                  marginTop: 4,
                }}
              >
                <Ionicons name="information-circle" size={20} color={Colors.warning} />
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: Colors.warning,
                    flex: 1,
                    lineHeight: 18,
                  }}
                >
                  This information is for educational purposes only. Always
                  consult a qualified healthcare professional before using any
                  herbal remedy.
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'plant_health' && (
            <View
              style={{
                backgroundColor: Colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
                padding: 20,
                gap: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="fitness" size={20} color={plantHealth?.is_healthy ? Colors.success : Colors.error} />
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 17,
                    color: Colors.textPrimary,
                  }}
                >
                  Plant Health Diagnosis
                </Text>
              </View>

              {plantHealth ? (
                <>
                  {/* Status badge */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      backgroundColor: plantHealth.is_healthy
                        ? 'rgba(46,125,50,0.08)'
                        : plantHealth.severity === 'severe'
                        ? 'rgba(211,47,47,0.08)'
                        : plantHealth.severity === 'moderate'
                        ? 'rgba(255,111,0,0.08)'
                        : 'rgba(255,193,7,0.08)',
                      borderRadius: 14,
                      borderCurve: 'continuous',
                      padding: 14,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: plantHealth.is_healthy
                          ? 'rgba(46,125,50,0.15)'
                          : plantHealth.severity === 'severe'
                          ? 'rgba(211,47,47,0.15)'
                          : plantHealth.severity === 'moderate'
                          ? 'rgba(255,111,0,0.15)'
                          : 'rgba(255,193,7,0.15)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={plantHealth.is_healthy ? 'checkmark-circle' : 'alert-circle'}
                        size={22}
                        color={
                          plantHealth.is_healthy
                            ? Colors.success
                            : plantHealth.severity === 'severe'
                            ? Colors.error
                            : Colors.warning
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.bold,
                          fontSize: 15,
                          color: plantHealth.is_healthy
                            ? Colors.success
                            : plantHealth.severity === 'severe'
                            ? Colors.error
                            : Colors.warning,
                        }}
                      >
                        {plantHealth.condition_name}
                      </Text>
                      {!plantHealth.is_healthy && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: plantHealth.severity === 'severe'
                                ? 'rgba(211,47,47,0.15)'
                                : plantHealth.severity === 'moderate'
                                ? 'rgba(255,111,0,0.15)'
                                : 'rgba(255,193,7,0.15)',
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.semiBold,
                                fontSize: 11,
                                color: plantHealth.severity === 'severe'
                                  ? Colors.error
                                  : Colors.warning,
                                textTransform: 'uppercase',
                              }}
                            >
                              {plantHealth.severity}
                            </Text>
                          </View>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: 'rgba(46,125,50,0.1)',
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.semiBold,
                                fontSize: 11,
                                color: Colors.primary,
                                textTransform: 'uppercase',
                              }}
                            >
                              {plantHealth.cause_category?.replace('_', ' ')}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Symptoms */}
                  {plantHealth.symptoms && !plantHealth.is_healthy && (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="eye-outline" size={16} color={Colors.primary} />
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary }}>
                          Symptoms Observed
                        </Text>
                      </View>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 14,
                          color: Colors.textPrimary,
                          lineHeight: 22,
                          paddingLeft: 22,
                        }}
                      >
                        {plantHealth.symptoms}
                      </Text>
                    </View>
                  )}

                  {/* Cause */}
                  {plantHealth.cause && !plantHealth.is_healthy && (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="bug-outline" size={16} color={Colors.primary} />
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary }}>
                          Likely Cause
                        </Text>
                      </View>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 14,
                          color: Colors.textPrimary,
                          lineHeight: 22,
                          paddingLeft: 22,
                        }}
                      >
                        {plantHealth.cause}
                      </Text>
                    </View>
                  )}

                  {/* Treatments */}
                  {plantHealth.treatments && !plantHealth.is_healthy && (
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="medkit-outline" size={16} color={Colors.primary} />
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary }}>
                          Recommended Treatments
                        </Text>
                      </View>

                      {plantHealth.treatments.organic && (
                        <View
                          style={{
                            backgroundColor: 'rgba(139,195,74,0.08)',
                            borderRadius: 12,
                            borderCurve: 'continuous',
                            padding: 12,
                            marginLeft: 22,
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="leaf-outline" size={14} color={Colors.accent} />
                            <Text style={{ fontFamily: Fonts.semiBold, fontSize: 13, color: Colors.primary }}>
                              Organic / Natural
                            </Text>
                          </View>
                          <Text
                            selectable
                            style={{
                              fontFamily: Fonts.regular,
                              fontSize: 13,
                              color: Colors.textPrimary,
                              lineHeight: 20,
                            }}
                          >
                            {plantHealth.treatments.organic}
                          </Text>
                        </View>
                      )}

                      {plantHealth.treatments.chemical && (
                        <View
                          style={{
                            backgroundColor: 'rgba(33,150,243,0.06)',
                            borderRadius: 12,
                            borderCurve: 'continuous',
                            padding: 12,
                            marginLeft: 22,
                            gap: 6,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="flask-outline" size={14} color="#1976D2" />
                            <Text style={{ fontFamily: Fonts.semiBold, fontSize: 13, color: '#1976D2' }}>
                              Chemical
                            </Text>
                          </View>
                          <Text
                            selectable
                            style={{
                              fontFamily: Fonts.regular,
                              fontSize: 13,
                              color: Colors.textPrimary,
                              lineHeight: 20,
                            }}
                          >
                            {plantHealth.treatments.chemical}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Prevention Tips */}
                  {plantHealth.prevention_tips && !plantHealth.is_healthy && (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="shield-checkmark-outline" size={16} color={Colors.primary} />
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary }}>
                          Prevention Tips
                        </Text>
                      </View>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 14,
                          color: Colors.textPrimary,
                          lineHeight: 22,
                          paddingLeft: 22,
                        }}
                      >
                        {plantHealth.prevention_tips}
                      </Text>
                    </View>
                  )}

                  {/* General Care Tips */}
                  {plantHealth.general_care_tips && (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="sunny-outline" size={16} color={Colors.primary} />
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary }}>
                          {plantHealth.is_healthy ? 'General Care Tips' : 'Ongoing Care'}
                        </Text>
                      </View>
                      <Text
                        selectable
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 14,
                          color: Colors.textPrimary,
                          lineHeight: 22,
                          paddingLeft: 22,
                        }}
                      >
                        {plantHealth.general_care_tips}
                      </Text>
                    </View>
                  )}

                  {/* Healthy plant message */}
                  {plantHealth.is_healthy && (
                    <View
                      style={{
                        backgroundColor: 'rgba(46,125,50,0.06)',
                        borderRadius: 12,
                        borderCurve: 'continuous',
                        padding: 14,
                        flexDirection: 'row',
                        gap: 10,
                        marginTop: 4,
                      }}
                    >
                      <Ionicons name="happy-outline" size={20} color={Colors.success} />
                      <Text
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 13,
                          color: Colors.success,
                          flex: 1,
                          lineHeight: 19,
                        }}
                      >
                        This plant appears healthy! No visible signs of disease, pest damage, or nutrient deficiencies were detected.
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 15,
                    color: Colors.textSecondary,
                    textAlign: 'center',
                    paddingVertical: 20,
                  }}
                >
                  No plant health data available for this scan.
                </Text>
              )}

              {/* Agronomist disclaimer */}
              <View
                style={{
                  backgroundColor: 'rgba(33,150,243,0.06)',
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  padding: 14,
                  flexDirection: 'row',
                  gap: 10,
                  marginTop: 4,
                }}
              >
                <Ionicons name="information-circle" size={20} color="#1976D2" />
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: '#1976D2',
                    flex: 1,
                    lineHeight: 18,
                  }}
                >
                  This AI-powered diagnosis is for guidance only. For critical crop decisions, confirm with laboratory testing or consult a certified agronomist.
                </Text>
              </View>
            </View>
          )}
        </Animated.View>

        {/* Ailment Query Section */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(500)}
          style={{
            marginHorizontal: 16,
            marginTop: 20,
          }}
        >
          <AilmentQuery
            plantName={scan.plant_name || 'Unknown Plant'}
            scientificName={scan.scientific_name}
          />
        </Animated.View>
      </ScrollView>

      {/* Bottom actions */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          backgroundColor: Colors.background,
          gap: 10,
          borderTopWidth: 0.5,
          borderTopColor: Colors.border,
        }}
      >
        <Pressable
          onPress={toggleArchive}
          disabled={archiving}
          style={({ pressed }) => ({
            backgroundColor: isArchived ? Colors.accent : Colors.primary,
            paddingVertical: 16,
            borderRadius: 14,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: archiving ? 0.7 : pressed ? 0.9 : 1,
          })}
        >
          {archiving ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <>
              <Ionicons
                name={isArchived ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={Colors.white}
              />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 16,
                  color: Colors.white,
                }}
              >
                {isArchived ? 'Archived' : 'Archive This Remedy'}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.push('/scan')}
          style={({ pressed }) => ({
            backgroundColor: Colors.card,
            paddingVertical: 14,
            borderRadius: 14,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            borderWidth: 1.5,
            borderColor: Colors.primary,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Ionicons name="camera-outline" size={18} color={Colors.primary} />
          <Text
            style={{
              fontFamily: Fonts.bold,
              fontSize: 15,
              color: Colors.primary,
            }}
          >
            Scan Again
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
