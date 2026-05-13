import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Platform,
  Pressable,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { CreditBadge } from '@/components/credit-badge';
import { getHerbalReferenceContext, shouldRefreshCache, refreshHerbalReferenceCache } from '@/lib/herbal-reference';
import { identifyPlantWithPlantNet, identifyPlantDisease } from '@/lib/plantnet';
import { extractErrorMessage, logError } from '@/lib/error-utils';
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';

const SHOW_CANCEL_AFTER_MS = 15000;

type AnalysisStage = 'identifying' | 'disease_check' | 'saving';

interface CaptureStep {
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  organ: string;
}

const CAPTURE_STEPS: CaptureStep[] = [
  {
    label: 'Photo 1 of 3 — Leaf',
    subtitle: 'Capture a clear shot of the leaf, showing its shape and veins',
    icon: 'leaf',
    organ: 'leaf',
  },
  {
    label: 'Photo 2 of 3 — Flower / Fruit',
    subtitle: 'Capture the flower, fruit, or bud if visible',
    icon: 'flower',
    organ: 'flower',
  },
  {
    label: 'Photo 3 of 3 — Bark / Stem',
    subtitle: 'Capture the bark, stem, or overall plant habit',
    icon: 'git-branch',
    organ: 'bark',
  },
];

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();

  // Multi-image capture state
  const [capturedImages, setCapturedImages] = useState<(string | null)[]>([null, null, null]);
  const [currentCaptureIndex, setCurrentCaptureIndex] = useState(0);
  const [step, setStep] = useState<'intro' | 'capturing' | 'review' | 'analyzing'>('intro');
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('identifying');
  const [showCancel, setShowCancel] = useState(false);
  const [stageMessage, setStageMessage] = useState('');

  const cancelledRef = useRef(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedRef = useRef(false);

  const credits = profile?.scan_credits ?? 0;

  // Pre-load herbal reference context
  useEffect(() => {
    const loadHerbalContext = async () => {
      try {
        const needsRefresh = await shouldRefreshCache();
        if (needsRefresh) {
          await refreshHerbalReferenceCache();
        }
        await getHerbalReferenceContext();
      } catch {
        // Gracefully degrade
      }
    };
    loadHerbalContext();
  }, []);

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
    setStep('review');
    setShowCancel(false);
    setStageMessage('');
  }, [clearCancelTimer]);

  const capturedCount = capturedImages.filter(Boolean).length;

  const pickImageForStep = async (stepIndex: number, useCamera: boolean) => {
    if (credits <= 0) {
      Alert.alert(
        'Free Scans Used Up',
        "You've used all your free scans! Top up to continue identifying plants — $1.25 for 15 scans.",
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
        const newImages = [...capturedImages];
        newImages[stepIndex] = result.assets[0].uri;
        setCapturedImages(newImages);

        // Advance to next uncaptured step or go to review
        const nextEmptyIndex = newImages.findIndex((img, idx) => idx > stepIndex && !img);
        if (nextEmptyIndex !== -1) {
          setCurrentCaptureIndex(nextEmptyIndex);
        } else if (newImages.every(Boolean)) {
          // All 3 captured, go to review
          setStep('review');
        } else {
          // Find next empty
          const anyEmpty = newImages.findIndex((img) => !img);
          if (anyEmpty !== -1) {
            setCurrentCaptureIndex(anyEmpty);
          } else {
            setStep('review');
          }
        }
      }
    } catch (e) {
      logError('[scan] Image picker error', e);
      Alert.alert('Error', extractErrorMessage(e, 'Failed to capture image. Please try again.'));
    }
  };

  const handleRetakeImage = (index: number) => {
    setCurrentCaptureIndex(index);
    setStep('capturing');
  };

  const handleStartCapture = () => {
    if (credits <= 0) {
      Alert.alert(
        'Free Scans Used Up',
        "You've used all your free scans! Top up to continue identifying plants — $1.25 for 15 scans.",
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Top Up Now', onPress: () => router.push('/topup') },
        ]
      );
      return;
    }
    setStep('capturing');
    setCurrentCaptureIndex(0);
    setCapturedImages([null, null, null]);
  };

  const handleAnalyze = async () => {
    const validImages = capturedImages.filter(Boolean) as string[];
    if (validImages.length === 0 || !user?.id) return;

    setStep('analyzing');
    setAnalysisStage('identifying');
    setStageMessage('Identifying plant species from multiple angles...');
    setShowCancel(false);
    cancelledRef.current = false;
    processedRef.current = false;
    startCancelTimer();

    try {
      // Build organ types array based on which images are present
      const organs = capturedImages.map((img, idx) =>
        img ? CAPTURE_STEPS[idx].organ : null
      ).filter(Boolean) as string[];

      // STAGE 1: Plant identification with all images
      const plantResult = await identifyPlantWithPlantNet(validImages, organs);

      if (cancelledRef.current) return;

      if (!plantResult.success) {
        clearCancelTimer();
        const error = plantResult.error;
        Alert.alert(
          error.type === 'timeout' ? 'Identification Timed Out' : 'Identification Failed',
          error.message,
          [{ text: 'OK' }]
        );
        setStep('review');
        setShowCancel(false);
        return;
      }

      const { topResults } = plantResult;
      clearCancelTimer();

      if (cancelledRef.current) return;

      // STAGE 2: Disease identification with all images
      setAnalysisStage('disease_check');
      setStageMessage('Checking plant health...');
      setShowCancel(false);
      startCancelTimer();

      let diseaseResultData: any = null;
      let diseaseErrorMsg = '';

      try {
        const diseaseResult = await identifyPlantDisease(validImages);

        if (cancelledRef.current) return;

        if (diseaseResult.success) {
          diseaseResultData = diseaseResult.data;
        } else {
          diseaseErrorMsg = diseaseResult.error.message;
        }
      } catch (diseaseErr: unknown) {
        logError('[scan] Disease identification error (non-blocking)', diseaseErr);
        diseaseErrorMsg = extractErrorMessage(diseaseErr, 'Disease check failed. You can retry from the Plant Health tab.');
      }

      if (cancelledRef.current) return;
      clearCancelTimer();

      // STAGE 3: Upload images to Supabase Storage + deduct credit
      setAnalysisStage('saving');
      setStageMessage('Saving results...');
      setShowCancel(false);

      // Upload first valid image as the primary image
      let imageUrl = '';
      try {
        const primaryImage = validImages[0];
        const fileName = `${user.id}/${Date.now()}.jpg`;

        if (Platform.OS === 'web') {
          // On web, fetch + blob works correctly for data/blob URIs
          const response = await fetch(primaryImage);
          const blob = await response.blob();
          const { error: uploadErr } = await supabase.storage
            .from('scan-images')
            .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

          if (uploadErr) {
            console.error('Web upload error:', uploadErr);
          } else {
            const { data: urlData } = supabase.storage.from('scan-images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
          }
        } else {
          // On native, use expo-file-system's File class (implements Blob) to read the image
          // and convert to ArrayBuffer for reliable Supabase Storage upload
          const file = new ExpoFile(primaryImage);
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          const { error: uploadErr } = await supabase.storage
            .from('scan-images')
            .upload(fileName, uint8Array, { contentType: 'image/jpeg', upsert: true });

          if (uploadErr) {
            console.error('Native upload error:', uploadErr);
          } else {
            const { data: urlData } = supabase.storage.from('scan-images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
          }
        }
      } catch (uploadE: unknown) {
        logError('[scan] Upload error (non-blocking)', uploadE);
      }

      if (cancelledRef.current) return;

      // Deduct 1 credit for the entire 3-image scan
      const newCredits = Math.max(0, credits - 1);
      await supabase
        .from('users')
        .update({ scan_credits: newCredits })
        .eq('id', user.id);
      updateCredits(newCredits);

      // Navigate to result screen
      if (!cancelledRef.current) {
        router.replace({
          pathname: '/result',
          params: {
            imageUrl: imageUrl, // Only pass permanent Supabase Storage URL (empty if upload failed)
            localImageUri: validImages[0], // Local URI only for immediate display during this session
            topResults: JSON.stringify(topResults),
            diseaseResults: diseaseResultData
              ? JSON.stringify(diseaseResultData)
              : JSON.stringify(null),
            diseaseError: diseaseErrorMsg,
          },
        });
      }
    } catch (e: unknown) {
      logError('[scan] Analysis error', e);
      clearCancelTimer();

      if (cancelledRef.current) return;

      const errorMsg = extractErrorMessage(e, 'Plant analysis failed. Please try again.');
      Alert.alert('Analysis Failed', errorMsg.substring(0, 250), [{ text: 'OK' }]);
      setStep('review');
      setShowCancel(false);
    } finally {
      clearCancelTimer();
      setShowCancel(false);
    }
  };

  const getStageProgress = (): { step: number; total: number; label: string } => {
    switch (analysisStage) {
      case 'identifying':
        return { step: 1, total: 3, label: 'Identifying Plant' };
      case 'disease_check':
        return { step: 2, total: 3, label: 'Checking Health' };
      case 'saving':
        return { step: 3, total: 3, label: 'Saving Results' };
      default:
        return { step: 1, total: 3, label: 'Processing' };
    }
  };


  // ============================================================
  // INTRO SCREEN — same "Identify a Plant" landing with "Start Scan"
  // ============================================================
  if (step === 'intro') {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.primaryDark }}>
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

        {/* Title */}
        <View style={{ paddingHorizontal: 24, paddingTop: 32, alignItems: 'center', gap: 8 }}>
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
              maxWidth: 300,
            }}
          >
            Capture 3 photos from different parts of the plant for the most accurate identification
          </Animated.Text>
        </View>

        {/* Steps preview */}
        <Animated.View
          entering={FadeInUp.delay(400).duration(600)}
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            gap: 12,
          }}
        >
          {CAPTURE_STEPS.map((captureStep, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 16,
                borderCurve: 'continuous',
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderWidth: 1,
                borderColor: 'rgba(139,195,74,0.15)',
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(139,195,74,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={captureStep.icon} size={22} color={Colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{
                    fontFamily: Fonts.semiBold,
                    fontSize: 15,
                    color: Colors.white,
                  }}
                >
                  {captureStep.label}
                </Text>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 17,
                  }}
                >
                  {captureStep.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>

        {/* Bottom */}
        <View
          style={{
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 24,
            gap: 14,
            alignItems: 'center',
          }}
        >
          <Animated.View
            entering={FadeInUp.delay(600).duration(500)}
            style={{ width: '100%' }}
          >
            <Pressable
              onPress={handleStartCapture}
              style={({ pressed }) => ({
                backgroundColor: Colors.accent,
                paddingVertical: 18,
                borderRadius: 16,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 10,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                boxShadow: '0 4px 20px rgba(139,195,74,0.35)',
              })}
            >
              <Ionicons name="camera" size={22} color={Colors.white} />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 17,
                  color: Colors.white,
                }}
              >
                Start Scan
              </Text>
            </Pressable>
          </Animated.View>

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
                Free scans used up — $1.25 for 15 more
              </Text>
            </Pressable>
          )}

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
            <Ionicons name="flash-outline" size={14} color="rgba(255,255,255,0.4)" />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: 'rgba(255,255,255,0.4)',
              }}
            >
              All 3 photos count as 1 scan credit
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ============================================================
  // CAPTURING STEP — guided capture for each of 3 images
  // ============================================================
  if (step === 'capturing') {
    const currentStep = CAPTURE_STEPS[currentCaptureIndex];
    const currentImage = capturedImages[currentCaptureIndex];

    return (
      <View style={{ flex: 1, backgroundColor: Colors.primaryDark }}>
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
            onPress={() => {
              if (capturedCount === 0) {
                setStep('intro');
              } else {
                setStep('review');
              }
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </Pressable>
          <CreditBadge credits={credits} showTopUp={false} compact />
        </View>

        {/* Progress dots */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            paddingTop: 16,
            paddingBottom: 8,
          }}
        >
          {CAPTURE_STEPS.map((_, idx) => {
            const isCurrent = idx === currentCaptureIndex;
            const isDone = !!capturedImages[idx];
            return (
              <View
                key={idx}
                style={{
                  width: isCurrent ? 28 : 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: isDone
                    ? Colors.accent
                    : isCurrent
                      ? Colors.accent
                      : 'rgba(255,255,255,0.2)',
                  opacity: isCurrent ? 1 : isDone ? 0.8 : 0.4,
                }}
              />
            );
          })}
        </View>

        {/* Step label & instruction */}
        <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, gap: 6 }}>
          <Animated.View
            key={`icon-${currentCaptureIndex}`}
            entering={ZoomIn.duration(300)}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: 'rgba(139,195,74,0.15)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
              }}
            >
              <Ionicons name={currentStep.icon} size={28} color={Colors.accent} />
            </View>
          </Animated.View>
          <Animated.Text
            key={`label-${currentCaptureIndex}`}
            entering={FadeInDown.duration(300)}
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.white,
              textAlign: 'center',
            }}
          >
            {currentStep.label}
          </Animated.Text>
          <Animated.Text
            key={`subtitle-${currentCaptureIndex}`}
            entering={FadeInDown.delay(100).duration(300)}
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              textAlign: 'center',
              lineHeight: 20,
              maxWidth: 280,
            }}
          >
            {currentStep.subtitle}
          </Animated.Text>
        </View>

        {/* Thumbnail strip showing captured images */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 10,
            paddingTop: 20,
            paddingHorizontal: 24,
          }}
        >
          {capturedImages.map((img, idx) => (
            <Pressable
              key={idx}
              onPress={() => setCurrentCaptureIndex(idx)}
              style={{
                width: 60,
                height: 60,
                borderRadius: 14,
                borderCurve: 'continuous',
                overflow: 'hidden',
                borderWidth: 2,
                borderColor:
                  idx === currentCaptureIndex
                    ? Colors.accent
                    : img
                      ? 'rgba(139,195,74,0.4)'
                      : 'rgba(255,255,255,0.15)',
                backgroundColor: img ? 'transparent' : 'rgba(255,255,255,0.06)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {img ? (
                <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Ionicons
                  name={CAPTURE_STEPS[idx].icon}
                  size={20}
                  color="rgba(255,255,255,0.3)"
                />
              )}
              {img && (
                <View
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: Colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="checkmark" size={10} color={Colors.white} />
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Preview of current image if already captured */}
        {currentImage && (
          <Animated.View
            entering={FadeIn.duration(300)}
            style={{
              flex: 1,
              marginHorizontal: 24,
              marginTop: 20,
              borderRadius: 20,
              borderCurve: 'continuous',
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: 'rgba(139,195,74,0.3)',
            }}
          >
            <Image
              source={{ uri: currentImage }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          </Animated.View>
        )}

        {/* Empty state when no image captured yet */}
        {!currentImage && (
          <View
            style={{
              flex: 1,
              marginHorizontal: 24,
              marginTop: 20,
              borderRadius: 20,
              borderCurve: 'continuous',
              borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.1)',
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.03)',
              gap: 12,
            }}
          >
            <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.2)" />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 14,
                color: 'rgba(255,255,255,0.35)',
                textAlign: 'center',
              }}
            >
              Tap a button below to capture
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View
          style={{
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 24,
            paddingTop: 16,
            gap: 12,
          }}
        >
          {/* Camera + Gallery row */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={() => pickImageForStep(currentCaptureIndex, true)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: pressed ? Colors.accent : 'rgba(139,195,74,0.85)',
                paddingVertical: 16,
                borderRadius: 14,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Ionicons name="camera" size={20} color={Colors.white} />
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: 15,
                  color: Colors.white,
                }}
              >
                {currentImage ? 'Retake' : 'Camera'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => pickImageForStep(currentCaptureIndex, false)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)',
                paddingVertical: 16,
                borderRadius: 14,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.2)',
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Ionicons name="images" size={20} color={Colors.white} />
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 15,
                  color: Colors.white,
                }}
              >
                Gallery
              </Text>
            </Pressable>
          </View>

          {/* Skip / Done */}
          {capturedCount > 0 && (
            <Pressable
              onPress={() => setStep('review')}
              style={{
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 14,
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
                {capturedCount === 3 ? 'Review All Photos →' : `Skip to Review (${capturedCount}/3 captured)`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ============================================================
  // REVIEW SCREEN — all 3 thumbnails with retake + identify button
  // ============================================================
  if (step === 'review') {
    const validImages = capturedImages.filter(Boolean) as string[];
    const allCaptured = capturedImages.every(Boolean);

    return (
      <View style={{ flex: 1, backgroundColor: Colors.primaryDark }}>
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
            onPress={() => {
              setCapturedImages([null, null, null]);
              setCurrentCaptureIndex(0);
              setStep('intro');
              processedRef.current = false;
            }}
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

        {/* Title */}
        <View style={{ alignItems: 'center', paddingTop: 20, paddingHorizontal: 24, gap: 6 }}>
          <Animated.Text
            entering={FadeInDown.duration(400)}
            style={{
              fontFamily: Fonts.bold,
              fontSize: 22,
              color: Colors.white,
              textAlign: 'center',
            }}
          >
            Review Your Photos
          </Animated.Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 14,
              color: 'rgba(255,255,255,0.55)',
              textAlign: 'center',
            }}
          >
            {allCaptured
              ? 'All 3 photos captured! Ready to identify.'
              : `${capturedCount} of 3 photos captured. Tap + to add more.`}
          </Text>
        </View>

        {/* Image grid */}
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 24,
            paddingBottom: 20,
            gap: 16,
          }}
          style={{ flex: 1 }}
        >
          {CAPTURE_STEPS.map((captureStep, idx) => {
            const img = capturedImages[idx];
            const imageSize = width - 48;

            return (
              <Animated.View
                key={idx}
                entering={FadeInUp.delay(idx * 100).duration(400)}
                style={{
                  borderRadius: 20,
                  borderCurve: 'continuous',
                  overflow: 'hidden',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderWidth: 1.5,
                  borderColor: img ? 'rgba(139,195,74,0.3)' : 'rgba(255,255,255,0.1)',
                }}
              >
                {img ? (
                  <View>
                    <Image
                      source={{ uri: img }}
                      style={{ width: imageSize, height: imageSize * 0.6 }}
                      contentFit="cover"
                    />
                    {/* Label overlay */}
                    <View
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 10,
                        borderCurve: 'continuous',
                      }}
                    >
                      <Ionicons name={captureStep.icon} size={14} color={Colors.accent} />
                      <Text
                        style={{
                          fontFamily: Fonts.semiBold,
                          fontSize: 12,
                          color: Colors.white,
                        }}
                      >
                        {captureStep.label.split(' — ')[1]}
                      </Text>
                    </View>
                    {/* Retake button */}
                    <Pressable
                      onPress={() => handleRetakeImage(idx)}
                      style={({ pressed }) => ({
                        position: 'absolute',
                        bottom: 10,
                        right: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        backgroundColor: pressed ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.6)',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                        borderCurve: 'continuous',
                      })}
                    >
                      <Ionicons name="camera-reverse" size={14} color={Colors.white} />
                      <Text
                        style={{
                          fontFamily: Fonts.semiBold,
                          fontSize: 12,
                          color: Colors.white,
                        }}
                      >
                        Retake
                      </Text>
                    </Pressable>
                    {/* Check badge */}
                    <View
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: Colors.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="checkmark" size={14} color={Colors.white} />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => handleRetakeImage(idx)}
                    style={{
                      width: imageSize,
                      height: imageSize * 0.4,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                    }}
                  >
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1.5,
                        borderColor: 'rgba(255,255,255,0.15)',
                        borderStyle: 'dashed',
                      }}
                    >
                      <Ionicons name="add" size={24} color="rgba(255,255,255,0.4)" />
                    </View>
                    <View style={{ alignItems: 'center', gap: 2 }}>
                      <Text
                        style={{
                          fontFamily: Fonts.semiBold,
                          fontSize: 14,
                          color: 'rgba(255,255,255,0.6)',
                        }}
                      >
                        {captureStep.label.split(' — ')[1]}
                      </Text>
                      <Text
                        style={{
                          fontFamily: Fonts.regular,
                          fontSize: 12,
                          color: 'rgba(255,255,255,0.35)',
                        }}
                      >
                        Tap to add photo
                      </Text>
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            );
          })}
        </ScrollView>

        {/* Bottom actions */}
        <View
          style={{
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 24,
            paddingTop: 12,
            gap: 10,
            backgroundColor: Colors.primaryDark,
            borderTopWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.06)',
          }}
        >
          {/* Credit notice */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 6,
            }}
          >
            <Ionicons name="flash" size={13} color={Colors.accent} />
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 12,
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              Uses 1 scan credit for all {capturedCount} photos
            </Text>
          </View>

          {/* Identify button */}
          <Pressable
            onPress={handleAnalyze}
            disabled={validImages.length === 0}
            style={({ pressed }) => ({
              backgroundColor: validImages.length > 0
                ? pressed ? Colors.primary : Colors.accent
                : 'rgba(255,255,255,0.1)',
              paddingVertical: 18,
              borderRadius: 16,
              borderCurve: 'continuous',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 10,
              opacity: validImages.length === 0 ? 0.5 : pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              boxShadow: validImages.length > 0 ? '0 4px 20px rgba(139,195,74,0.3)' : 'none',
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

          {/* Add more photos link */}
          {!allCaptured && (
            <Pressable
              onPress={() => {
                const nextEmpty = capturedImages.findIndex((img) => !img);
                if (nextEmpty !== -1) {
                  setCurrentCaptureIndex(nextEmpty);
                  setStep('capturing');
                }
              }}
              style={{ paddingVertical: 10, alignItems: 'center' }}
            >
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 14,
                  color: Colors.accent,
                }}
              >
                + Add Remaining Photos
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ============================================================
  // ANALYZING SCREEN
  // ============================================================
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: Colors.primaryDark,
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
        {stageMessage || 'Analyzing your plant images...'}
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
        {['Identify', 'Health', 'Save'].map((label, idx) => {
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

      {/* Image thumbnails strip */}
      <Animated.View
        entering={FadeIn.delay(600).duration(500)}
        style={{
          flexDirection: 'row',
          gap: 8,
          marginTop: 12,
        }}
      >
        {capturedImages.filter(Boolean).map((img, idx) => (
          <View
            key={idx}
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              borderCurve: 'continuous',
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: 'rgba(139,195,74,0.3)',
            }}
          >
            <Image
              source={{ uri: img! }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          </View>
        ))}
      </Animated.View>

      {/* Cancel/Retry button — appears after 15 seconds */}
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
  );
}
