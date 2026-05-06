import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useAuth } from '@fastshot/auth';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { AilmentQuery } from '@/components/ailment-query';
import type { Tables, RemedyData, PlantHealthData } from '@/lib/types';
import Animated, { FadeInDown } from 'react-native-reanimated';

type TabKey = 'overview' | 'remedies' | 'precautions' | 'plant_health';

export default function ResultScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const { user } = useAuth();
  const { archivedIds, addArchivedId, removeArchivedId } = useAppStore();
  const [scan, setScan] = useState<Tables<'scans'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [archiving, setArchiving] = useState(false);

  const isArchived = scanId ? archivedIds.includes(scanId) : false;

  const fetchScan = useCallback(async () => {
    if (!scanId) return;
    try {
      const { data, error } = await supabase
        .from('scans')
        .select('*')
        .eq('id', scanId)
        .single();

      if (error) throw error;
      setScan(data);
    } catch (e) {
      console.error('Error fetching scan:', e);
      Alert.alert('Error', 'Failed to load scan result');
    } finally {
      setLoading(false);
    }
  }, [scanId]);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

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

  const toggleArchive = async () => {
    if (!scan || !user?.id || !scanId) return;
    setArchiving(true);

    try {
      if (isArchived) {
        await supabase
          .from('archived_remedies')
          .delete()
          .eq('user_id', user.id)
          .eq('scan_id', scanId);
        removeArchivedId(scanId);
      } else {
        await supabase.from('archived_remedies').insert({
          user_id: user.id,
          scan_id: scanId,
        });
        addArchivedId(scanId);
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
        {/* Plant image header */}
        <View style={{ height: 280, backgroundColor: Colors.primaryDark }}>
          {scan.image_url ? (
            <Image
              source={{ uri: scan.image_url }}
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

                      {/* Organic treatments */}
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

                      {/* Chemical treatments */}
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

                  {/* General Care Tips (shown always, especially when healthy) */}
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
                        This plant appears healthy! No visible signs of disease, pest damage, or nutrient deficiencies were detected. Continue following the care tips above to maintain plant health.
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
