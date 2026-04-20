import { useState, useCallback, useRef } from 'react';
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
import { useImageAnalysis, useTextGeneration } from '@fastshot/ai';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { CreditBadge } from '@/components/credit-badge';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { profile, updateCredits } = useAppStore();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [step, setStep] = useState<'capture' | 'preview' | 'analyzing'>('capture');

  const {
    analyzeImage,
    data: analysisData,
  } = useImageAnalysis();

  const {
    generateText,
  } = useTextGeneration();

  const credits = profile?.scan_credits ?? 0;

  const pickImage = async (useCamera: boolean) => {
    if (credits <= 0) {
      Alert.alert(
        'No Credits',
        'You need scan credits to identify plants. Top up now?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Top Up', onPress: () => router.push('/topup') },
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

  const handleAnalyze = async () => {
    if (!selectedImage || !user?.id) return;

    setStep('analyzing');
    setAnalyzing(true);

    try {
      // Step 1: Analyze the image to identify the plant
      await analyzeImage({
        imageUrl: selectedImage,
        prompt: `You are an expert botanist. Analyze this plant/leaf image and identify the species. Respond ONLY with valid JSON in this exact format, no other text:
{
  "plant_name": "Common Name",
  "scientific_name": "Scientific name in italics format",
  "confidence": 0.85,
  "overview": "A detailed 2-3 sentence description of the plant including its family, habitat, and distinguishing features.",
  "remedies": {
    "uses": "Main medicinal/herbal uses of the plant (2-3 sentences)",
    "preparation": "How to prepare the plant as a remedy - tea, poultice, tincture, etc.",
    "dosage": "Recommended dosage and frequency",
    "benefits": "Key health benefits (2-3 items)",
    "traditional_uses": "Traditional medicine uses from various cultures"
  },
  "precautions": "Important warnings, toxicity information, contraindications, and who should avoid this plant."
}

If you cannot identify the plant with reasonable confidence, still provide your best guess with a lower confidence score.`,
      });
    } catch (e) {
      console.error('Analysis error:', e);
      Alert.alert('Analysis Failed', 'Could not identify the plant. Please try again with a clearer photo.');
      setStep('preview');
      setAnalyzing(false);
      return;
    }
  };

  // When analysis data comes back, save the result
  const processedRef = useRef(false);

  const processResult = useCallback(async () => {
    if (!analysisData || !selectedImage || !user?.id || processedRef.current) return;
    processedRef.current = true;

    try {
      let parsed;
      try {
        // Try to extract JSON from the response
        const jsonMatch = analysisData.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      } catch {
        // If parsing fails, use text generation to get structured data
        await generateText(
          `Based on this plant analysis: "${analysisData}", create a JSON response with this structure:
{
  "plant_name": "Common Name",
  "scientific_name": "Scientific name",
  "confidence": 0.7,
  "overview": "Description",
  "remedies": { "uses": "", "preparation": "", "dosage": "", "benefits": "", "traditional_uses": "" },
  "precautions": "Warnings"
}
Only return the JSON, nothing else.`
        );
        return; // Will process when remedyData arrives
      }

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
        // Continue without image URL
      }

      // Save scan to database
      const { data: scanData, error: insertErr } = await supabase
        .from('scans')
        .insert({
          user_id: user.id,
          image_url: imageUrl || null,
          plant_name: parsed.plant_name || 'Unknown Plant',
          scientific_name: parsed.scientific_name || null,
          confidence: parsed.confidence || 0.5,
          overview: parsed.overview || null,
          remedies: parsed.remedies || null,
          precautions: parsed.precautions || null,
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
      if (scanData) {
        router.replace({
          pathname: '/result',
          params: { scanId: scanData.id },
        });
      }
    } catch (e) {
      console.error('Process result error:', e);
      Alert.alert('Error', 'Failed to save scan result. Please try again.');
      setStep('preview');
      processedRef.current = false;
    } finally {
      setAnalyzing(false);
    }
  }, [analysisData, selectedImage, user?.id]);

  // Trigger processing when analysis data arrives
  if (analysisData && analyzing && !processedRef.current) {
    processResult();
  }

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

          {/* Camera view placeholder with leaf frame */}
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 40,
            }}
          >
            {/* Leaf frame overlay */}
            <View
              style={{
                width: width - 100,
                height: width - 100,
                maxWidth: 300,
                maxHeight: 300,
                borderRadius: 30,
                borderCurve: 'continuous',
                borderWidth: 2,
                borderColor: 'rgba(139,195,74,0.5)',
                borderStyle: 'dashed',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
              }}
            >
              <Ionicons name="leaf-outline" size={64} color="rgba(139,195,74,0.4)" />
              <Text
                style={{
                  fontFamily: Fonts.semiBold,
                  fontSize: 14,
                  color: 'rgba(255,255,255,0.6)',
                  textAlign: 'center',
                }}
              >
                Frame the leaf for{'\n'}identification
              </Text>
            </View>
          </View>

          {/* Bottom controls */}
          <View
            style={{
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: 24,
              gap: 16,
              alignItems: 'center',
            }}
          >
            {credits === 0 && (
              <Pressable
                onPress={() => router.push('/topup')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(233,30,99,0.15)',
                  paddingHorizontal: 16,
                  paddingVertical: 8,
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
                  Need more scans? Top up with EcoCash
                </Text>
              </Pressable>
            )}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 40,
              }}
            >
              {/* Gallery */}
              <Pressable
                onPress={() => pickImage(false)}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="images" size={24} color={Colors.white} />
              </Pressable>

              {/* Capture */}
              <Pressable
                onPress={() => pickImage(true)}
                style={({ pressed }) => ({
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  backgroundColor: Colors.white,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 4,
                  borderColor: Colors.accent,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                })}
              >
                <Ionicons name="camera" size={32} color={Colors.primaryDark} />
              </Pressable>

              {/* Placeholder for balance */}
              <View style={{ width: 52, height: 52 }}>
                <Text
                  style={{
                    fontFamily: Fonts.regular,
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.5)',
                    textAlign: 'center',
                    marginTop: 14,
                  }}
                >
                  Photo{'\n'}Library
                </Text>
              </View>
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
          <Animated.Text
            entering={FadeInDown.delay(200).duration(500)}
            style={{
              fontFamily: Fonts.bold,
              fontSize: 20,
              color: Colors.white,
              textAlign: 'center',
            }}
          >
            Analyzing Plant...
          </Animated.Text>
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
            Our AI is identifying the plant species{'\n'}and gathering herbal remedy information
          </Animated.Text>

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
        </View>
      )}
    </View>
  );
}
