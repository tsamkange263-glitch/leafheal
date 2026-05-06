import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@fastshot/auth';
import { useTextGeneration } from '@fastshot/ai';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { CreditBadge } from '@/components/credit-badge';
import { getHerbalReferenceContext, shouldRefreshCache, refreshHerbalReferenceCache, getTargetedPlantReference } from '@/lib/herbal-reference';
import { identifyPlantWithPlantNet } from '@/lib/plantnet';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';

// Timeout constants
const REMEDY_TIMEOUT_MS = 30000; // 30 seconds for remedy generation
const SHOW_CANCEL_AFTER_MS = 10000; // Show cancel/retry after 10 seconds

type AnalysisStage = 'identifying' | 'enriching' | 'saving';

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [step, setStep] = useState<'capture' | 'preview' | 'analyzing'>('capture');
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('identifying');
  const [showCancel, setShowCancel] = useState(false);
  const [stageMessage, setStageMessage] = useState('');

  const cancelledRef = useRef(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    generateText,
  } = useTextGeneration();

  const credits = profile?.scan_credits ?? 0;

  // Pre-load herbal reference context from cached PDFs
  useEffect(() => {
    const loadHerbalContext = async () => {
      try {
        const needsRefresh = await shouldRefreshCache();
        if (needsRefresh) {
          await refreshHerbalReferenceCache();
        }
        // Just ensure cache is warm — we won't use full context in identification
        await getHerbalReferenceContext();
      } catch {
        // Gracefully degrade
      }
    };
    loadHerbalContext();
  }, []);

  // Start cancel timer when analysis begins
  const startCancelTimer = useCallback(() => {
    setShowCancel(false);
    cancelTimerRef.current = setTimeout(() => {
      setShowCancel(true);
    }, SHOW_CANCEL_AFTER_MS);
  }, []);

  const clearCancelTimer = useCallback(() => {
    if (cancelTimerRef.current) {
      clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    clearCancelTimer();
    setStep('preview');
    setShowCancel(false);
    setStageMessage('');
  }, [clearCancelTimer]);

  const pickImage = async (useCamera: boolean) => {
    if (credits <= 0) {
      Alert.alert(
        'Free Scans Used Up',
        "You've used all your free scans! Top up to continue identifying plants — $1 for 20 scans.",
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Top Up Now', onPress: () => router.push('/topup') },
        ]
      );
      return;
    }

    try {
      let result: ImagePicker.ImagePickerResult;

      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Needed', 'Camera access is required to scan plants.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsEditing: true,
          aspect: [1, 1],
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Needed', 'Photo library access is required to select images.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsEditing: true,
          aspect: [1, 1],
        });
      }

      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
        setStep('preview');
      }
    } catch (e) {
      console.error('Image picker error:', e);
      Alert.alert('Error', 'Failed to capture image. Please try again.');
    }
  };

  // Helper: wrap a promise with a timeout
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms / 1000} seconds`));
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  const handleAnalyze = async () => {
    if (!selectedImage || !user?.id) return;

    setStep('analyzing');
    setAnalysisStage('identifying');
    setStageMessage('Identifying plant species...');
    setShowCancel(false);
    cancelledRef.current = false;
    processedRef.current = false;
    startCancelTimer();

    try {
      // ============================================================
      // STAGE 1: Plant identification via PlantNet API
      // ============================================================
      const plantNetResult = await identifyPlantWithPlantNet(selectedImage);

      if (cancelledRef.current) return;

      if (!plantNetResult.success) {
        clearCancelTimer();
        const error = plantNetResult.error;
        Alert.alert(
          error.type === 'timeout' ? 'Identification Timed Out' : 'Identification Failed',
          error.message,
          [{ text: 'OK' }]
        );
        setStep('preview');
        setShowCancel(false);
        return;
      }

      const { plantName, scientificName, confidence, family, genus } = plantNetResult.data;
      clearCancelTimer();

      if (cancelledRef.current) return;

      // ============================================================
      // STAGE 2: AI enrichment — overview, remedies, health, precautions
      // ============================================================
      setAnalysisStage('enriching');
      setStageMessage(`Identified: ${plantName}\nLooking up herbal remedies...`);
      startCancelTimer();

      let enrichmentData: any = null;

      try {
        // Get targeted reference from herbal PDFs
        const targetedReference = await getTargetedPlantReference(plantName, scientificName);

        const referenceSection = targetedReference
          ? `\n\nRelevant herbal reference excerpts for ${plantName}:\n${targetedReference}\n\nUse the above reference data to enrich your response with specific preparation methods, dosages, and traditional uses. If the data doesn't match this plant, rely on your own knowledge.`
          : '';

        const enrichmentPrompt = `You are an expert botanist and herbalist. For the plant "${plantName}" (Scientific: ${scientificName}, Family: ${family}, Genus: ${genus}), provide comprehensive information.

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

        const enrichmentResult = await withTimeout(
          generateText(enrichmentPrompt),
          REMEDY_TIMEOUT_MS,
          'Plant enrichment'
        );

        if (enrichmentResult && !cancelledRef.current) {
          const match = enrichmentResult.match(/\{[\s\S]*\}/);
          if (match) {
            enrichmentData = JSON.parse(match[0]);
          }
        }
      } catch (e: any) {
        console.error('Enrichment error:', e);
        // Non-fatal: provide fallback data
        enrichmentData = {
          overview: `${plantName} (${scientificName}) is a member of the ${family} family. It belongs to the genus ${genus}.`,
          remedies: {
            uses: `${plantName} has various traditional medicinal uses. Further research is recommended for specific applications.`,
            preparation: 'Consult a qualified herbalist for preparation methods specific to your needs.',
            dosage: 'Dosage varies by preparation method. Consult a healthcare professional.',
            benefits: 'This plant has been used in traditional medicine. Specific benefits may vary.',
            traditional_uses: 'Used in various folk medicine traditions. More detailed information is being researched.',
          },
          precautions: 'Always consult a healthcare professional before using any plant medicinally. Some plants may interact with medications or be harmful in certain conditions.',
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

      if (cancelledRef.current) return;

      // ============================================================
      // STAGE 3: Save results
      // ============================================================
      setAnalysisStage('saving');
      setStageMessage('Saving your results...');
      clearCancelTimer();
      setShowCancel(false);

      // Build final result combining PlantNet identification + AI enrichment
      const finalResult = {
        plant_name: plantName,
        scientific_name: scientificName,
        confidence,
        overview: enrichmentData?.overview || `${plantName} (${scientificName}) is a member of the ${family} family.`,
        remedies: enrichmentData?.remedies || null,
        precautions: enrichmentData?.precautions || null,
        plant_health: enrichmentData?.plant_health || null,
      };

      // Upload image to Supabase Storage
      let imageUrl = '';
      try {
        const fileName = `${user.id}/${Date.now()}.jpg`;
        const response = await fetch(selectedImage);
        const blob = await response.blob();

        const { error: uploadErr } = await supabase.storage
          .from('scan-images')
          .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('scan-images')
            .getPublicUrl(fileName);
          imageUrl = urlData.publicUrl;
        }
      } catch (uploadE) {
        console.error('Upload error:', uploadE);
      }

      if (cancelledRef.current) return;

      // Save scan to database
      const { data: scanData, error: insertErr } = await supabase
        .from('scans')
        .insert({
          user_id: user.id,
          image_url: imageUrl || null,
          plant_name: finalResult.plant_name || 'Unknown Plant',
          scientific_name: finalResult.scientific_name || null,
          confidence: finalResult.confidence || 0.5,
          overview: finalResult.overview || null,
          remedies: finalResult.remedies || null,
          precautions: finalResult.precautions || null,
          plant_health: finalResult.plant_health || null,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Deduct credit
      const newCredits = Math.max(0, credits - 1);
      await supabase
        .from('users')
        .update({ scan_credits: newCredits })
        .eq('id', user.id);
      updateCredits(newCredits);

      // Navigate to result
      if (scanData && !cancelledRef.current) {
        router.replace({
          pathname: '/result',
          params: { scanId: scanData.id },
        });
      }
    } catch (e: any) {
      console.error('Analysis error:', e);
      clearCancelTimer();

      if (cancelledRef.current) return;

      Alert.alert(
        'Analysis Failed',
        'An unexpected error occurred. Please try again with a clearer photo.',
        [{ text: 'OK' }]
      );
      setStep('preview');
      setShowCancel(false);
    } finally {
      clearCancelTimer();
      setShowCancel(false);
    }
  };

  const processedRef = useRef(false);

  // Calculate card width for the two options (split layout)
  const cardWidth = (width - 24 * 2 - 14) / 2;

  // Stage progress indicator
  const getStageProgress = (): { step: number; total: number; label: string } => {
    switch (analysisStage) {
      case 'identifying':
        return { step: 1, total: 3, label: 'Identifying Plant' };
      case 'enriching':
        return { step: 2, total: 3, label: 'Looking Up Remedies' };
      case 'saving':
        return { step: 3, total: 3, label: 'Saving Results' };
      default:
        return { step: 1, total: 3, label: 'Processing' };
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: Colors.primaryDark,
      }}
    >
      {step === 'capture' && (
        <View style={{ flex: 1 }}>
          {/* Header */}
          <View
            style={{
              paddingTop: insets.top + 8,
              paddingHorizontal: 20,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              zIndex: 10,
            }}
          >
            <Pressable
              onPress={() => router.back()}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.15)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={22} color={Colors.white} />
            </Pressable>
            <CreditBadge credits={credits} showTopUp={false} compact />
          </View>

          {/* Title and description */}
          <View
            style={{
              paddingHorizontal: 24,
              paddingTop: 32,
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Animated.View entering={FadeIn.duration(600)}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: 'rgba(139,195,74,0.12)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                <Ionicons name="leaf" size={36} color={Colors.accent} />
              </View>
            </Animated.View>
            <Animated.Text
              entering={FadeInDown.delay(150).duration(500)}
              style={{
                fontFamily: Fonts.bold,
                fontSize: 24,
                color: Colors.white,
                textAlign: 'center',
              }}
            >
              Identify a Plant
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.delay(300).duration(500)}
              style={{
                fontFamily: Fonts.regular,
                fontSize: 15,
                color: 'rgba(255,255,255,0.6)',
                textAlign: 'center',
                lineHeight: 22,
                maxWidth: 280,
              }}
            >
              Take a photo or choose from your gallery to identify any plant instantly
            </Animated.Text>
          </View>

          {/* Two prominent option cards */}
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: 24,
            }}
          >
            <Animated.View
              entering={FadeInUp.delay(400).duration(600)}
              style={{
                flexDirection: 'row',
                gap: 14,
              }}
            >
              {/* Take Photo Card */}
              <Pressable
                onPress={() => pickImage(true)}
                style={({ pressed }) => ({
                  width: cardWidth,
                  backgroundColor: pressed ? 'rgba(139,195,74,0.25)' : 'rgba(139,195,74,0.12)',
                  borderRadius: 24,
                  borderCurve: 'continuous',
                  paddingVertical: 28,
                  paddingHorizontal: 16,
                  alignItems: 'center',
                  gap: 14,
                  borderWidth: 1.5,
                  borderColor: pressed ? Colors.accent : 'rgba(139,195,74,0.3)',
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: Colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(139,195,74,0.4)',
                  }}
                >
                  <Ionicons name="camera" size={30} color={Colors.white} />
                </View>
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 16,
                    color: Colors.white,
                    textAlign: 'center',
                  }}
                >
                  Take Photo
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.55)',
                    textAlign: 'center',
                    lineHeight: 17,
                  }}
                >
                  Open camera to{'\n'}capture a live image
                </Text>
              </Pressable>

              {/* Pick from Gallery Card */}
              <Pressable
                onPress={() => pickImage(false)}
                style={({ pressed }) => ({
                  width: cardWidth,
                  backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
                  borderRadius: 24,
                  borderCurve: 'continuous',
                  paddingVertical: 28,
                  paddingHorizontal: 16,
                  alignItems: 'center',
                  gap: 14,
                  borderWidth: 1.5,
                  borderColor: pressed ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderColor: 'rgba(255,255,255,0.2)',
                  }}
                >
                  <Ionicons name="images" size={28} color={Colors.white} />
                </View>
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 16,
                    color: Colors.white,
                    textAlign: 'center',
                  }}
                >
                  Gallery
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.55)',
                    textAlign: 'center',
                    lineHeight: 17,
                  }}
                >
                  Choose an existing{'\n'}photo from your library
                </Text>
              </Pressable>
            </Animated.View>
          </View>

          {/* Bottom area: tips and no-credits warning */}
          <View
            style={{
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: 24,
              gap: 14,
              alignItems: 'center',
            }}
          >
            {credits === 0 && (
              <Pressable
                onPress={() => router.push('/topup')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: 'rgba(233,30,99,0.15)',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderRadius: 20,
                }}
              >
                <Ionicons name="wallet-outline" size={16} color={Colors.ecocash} />
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 13,
                    color: Colors.ecocash,
                  }}
                >
                  Free scans used up — $1 for 20 more
                </Text>
              </Pressable>
            )}

            {/* Quick tips */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 12,
                borderCurve: 'continuous',
              }}
            >
              <Ionicons name="bulb-outline" size={14} color="rgba(255,255,255,0.4)" />
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.4)',
                }}
              >
                Tip: Use good lighting and focus on a single leaf for best results
              </Text>
            </View>
          </View>
        </View>
      )}

      {step === 'preview' && selectedImage && (
        <View style={{ flex: 1 }}>
          {/* Header */}
          <View
            style={{
              paddingTop: insets.top + 8,
              paddingHorizontal: 20,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
            }}
          >
            <Pressable
              onPress={() => {
                setSelectedImage(null);
                setStep('capture');
                processedRef.current = false;
              }}
              style={{
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
            <CreditBadge credits={credits} showTopUp={false} compact />
          </View>

          {/* Preview image */}
          <Image
            source={{ uri: selectedImage }}
            style={{ flex: 1 }}
            contentFit="cover"
          />

          {/* Analyze button */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: 24,
              paddingTop: 40,
              gap: 12,
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}
          >
            <Pressable
              onPress={handleAnalyze}
              style={({ pressed }) => ({
                backgroundColor: Colors.primary,
                paddingVertical: 18,
                borderRadius: 16,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Ionicons name="search" size={20} color={Colors.white} />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 17,
                  color: Colors.white,
                }}
              >
                Identify Plant
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSelectedImage(null);
                setStep('capture');
                processedRef.current = false;
              }}
              style={{
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 15,
                  color: Colors.white,
                }}
              >
                Retake Photo
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {step === 'analyzing' && (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 40,
            gap: 20,
          }}
        >
          {/* Progress indicator */}
          <Animated.View entering={FadeIn.duration(500)}>
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: 'rgba(139,195,74,0.15)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator size="large" color={Colors.accent} />
            </View>
          </Animated.View>

          {/* Stage title */}
          <Animated.Text
            entering={FadeInDown.delay(200).duration(500)}
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.white,
              textAlign: 'center',
            }}
          >
            {getStageProgress().label}
          </Animated.Text>

          {/* Stage message */}
          <Animated.Text
            entering={FadeInDown.delay(400).duration(500)}
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {stageMessage || 'Analyzing your plant image...'}
          </Animated.Text>

          {/* Progress steps */}
          <Animated.View
            entering={FadeIn.delay(500).duration(400)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            {[1, 2, 3].map((stepNum) => {
              const progress = getStageProgress();
              const isActive = stepNum === progress.step;
              const isComplete = stepNum < progress.step;
              return (
                <View
                  key={stepNum}
                  style={{
                    width: isActive ? 32 : 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: isComplete
                      ? Colors.accent
                      : isActive
                        ? Colors.accent
                        : 'rgba(255,255,255,0.2)',
                    opacity: isActive ? 1 : isComplete ? 0.8 : 0.4,
                  }}
                />
              );
            })}
          </Animated.View>

          {/* Step labels */}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 2 }}>
            {['Identify', 'Remedies', 'Save'].map((label, idx) => {
              const progress = getStageProgress();
              const isActive = idx + 1 === progress.step;
              const isComplete = idx + 1 < progress.step;
              return (
                <Text
                  key={label}
                  style={{
                    fontFamily: isActive ? Fonts.semiBold : Fonts.regular,
                    fontSize: 11,
                    color: isComplete
                      ? Colors.accent
                      : isActive
                        ? 'rgba(255,255,255,0.9)'
                        : 'rgba(255,255,255,0.35)',
                  }}
                >
                  {isComplete ? '✓ ' : ''}{label}
                </Text>
              );
            })}
          </View>

          {/* Image thumbnail */}
          {selectedImage && (
            <Animated.View
              entering={FadeIn.delay(600).duration(500)}
              style={{
                width: 120,
                height: 120,
                borderRadius: 20,
                borderCurve: 'continuous',
                overflow: 'hidden',
                marginTop: 12,
                borderWidth: 2,
                borderColor: 'rgba(139,195,74,0.3)',
              }}
            >
              <Image
                source={{ uri: selectedImage }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </Animated.View>
          )}

          {/* Cancel/Retry button — appears after 10 seconds */}
          {showCancel && (
            <Animated.View
              entering={FadeInDown.duration(400)}
              style={{ marginTop: 20, alignItems: 'center', gap: 12 }}
            >
              <Text
                style={{
                  fontFamily: Fonts.regular,
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.5)',
                  textAlign: 'center',
                }}
              >
                Taking longer than expected...
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  onPress={handleCancel}
                  style={({ pressed }) => ({
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.2)',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: Fonts.semiBold,
                      fontSize: 14,
                      color: Colors.white,
                    }}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    handleCancel();
                    // Small delay then retry
                    setTimeout(() => {
                      handleAnalyze();
                    }, 200);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    backgroundColor: Colors.accent,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Ionicons name="refresh" size={16} color={Colors.white} />
                  <Text
                    style={{
                      fontFamily: Fonts.semiBold,
                      fontSize: 14,
                      color: Colors.white,
                    }}
                  >
                    Retry
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      )}
    </View>
  );
}
