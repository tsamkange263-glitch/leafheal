/**
 * Plant Identification & Disease Detection API Service
 *
 * Clean implementation using standard React Native FormData with { uri, type, name }
 * format for file uploads. No Blob conversion needed on native platforms.
 */

import { Platform } from 'react-native';

const API_KEY = '2b10FwLN1xs3J5l1EAgj8PKY3O';
const PLANT_ID_URL = `https://my-api.plantnet.org/v2/identify/all?api-key=${API_KEY}`;
const DISEASE_ID_URL = `https://my-api.plantnet.org/v2/diseases/identify?include-related-images=true&api-key=${API_KEY}`;

// ============================================================
// Types
// ============================================================

export interface PlantNetResult {
  plantName: string;
  scientificName: string;
  confidence: number;
  family: string;
  genus: string;
  referenceImages: string[];
}

export interface PlantNetError {
  type: 'no_results' | 'low_confidence' | 'network_error' | 'api_error' | 'timeout';
  message: string;
}

export interface DiseaseResult {
  name: string;
  scientificName?: string;
  confidence: number;
  relatedImages: string[];
  description?: string;
}

export interface DiseaseIdentificationResponse {
  diseases: DiseaseResult[];
  isHealthy: boolean;
}

// ============================================================
// Plant Identification
// ============================================================

const MINIMUM_CONFIDENCE = 0.05;

/**
 * Identifies a plant from an image URI.
 * Uses React Native's FormData with { uri, type, name } objects on native,
 * and Blob-based approach on web.
 */
export async function identifyPlantWithPlantNet(
  imageUri: string
): Promise<
  | { success: true; data: PlantNetResult; topResults: PlantNetResult[] }
  | { success: false; error: PlantNetError }
> {
  try {
    if (!imageUri) {
      return {
        success: false,
        error: { type: 'api_error', message: 'No image provided for identification.' },
      };
    }

    const formData = new FormData();

    if (Platform.OS === 'web') {
      // On web, fetch the image as a blob and append it
      const response = await fetch(imageUri);
      const blob = await response.blob();
      formData.append('images', blob, 'plant.jpg');
    } else {
      // On native (iOS/Android), use the { uri, type, name } format
      // This is the standard React Native way to handle file uploads
      formData.append('images', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'plant.jpg',
      } as any);
    }

    formData.append('organs', 'auto');

    const response = await fetch(
      `${PLANT_ID_URL}&include-related-images=true&no-reject=false&nb-results=5&lang=en`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const statusCode = response.status;
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      if (statusCode === 404) {
        return {
          success: false,
          error: {
            type: 'no_results',
            message: 'No plant species could be identified from this image. Try a clearer photo focusing on leaves or flowers.',
          },
        };
      }

      if (statusCode === 429) {
        return {
          success: false,
          error: {
            type: 'api_error',
            message: 'Too many requests. Please wait a moment and try again.',
          },
        };
      }

      if (statusCode >= 500) {
        return {
          success: false,
          error: {
            type: 'api_error',
            message: 'Plant identification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Identification failed (error ${statusCode}): ${errorBody.substring(0, 150) || 'Unknown error'}`,
        },
      };
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return {
        success: false,
        error: {
          type: 'no_results',
          message: 'No plant species could be identified. Try taking a clearer photo with better lighting.',
        },
      };
    }

    // Sort by score descending and take the highest
    const sortedResults = [...data.results].sort(
      (a: any, b: any) => (b.score || 0) - (a.score || 0)
    );

    const bestResult = sortedResults[0];

    if (bestResult.score < MINIMUM_CONFIDENCE) {
      return {
        success: false,
        error: {
          type: 'low_confidence',
          message: `Identification confidence is too low (${Math.round(bestResult.score * 100)}%). Try a clearer photo with the plant leaf or flower in focus.`,
        },
      };
    }

    // Extract top 2 results with reference images
    const topResults: PlantNetResult[] = sortedResults.slice(0, 2).map((result: any) => {
      const commonNames = result.species?.commonNames;
      const name =
        commonNames && commonNames.length > 0
          ? commonNames[0]
          : result.species?.scientificNameWithoutAuthor || 'Unknown Plant';

      const refImages = (result.images || [])
        .slice(0, 3)
        .map((img: any) => img?.url?.m || img?.url?.o || img?.url?.s || img?.m || img?.o || img?.s || '')
        .filter(Boolean);

      return {
        plantName: name,
        scientificName: result.species?.scientificNameWithoutAuthor || 'Unknown',
        confidence: result.score || 0,
        family: result.species?.family?.scientificNameWithoutAuthor || 'Unknown',
        genus: result.species?.genus?.scientificNameWithoutAuthor || 'Unknown',
        referenceImages: refImages,
      };
    });

    return {
      success: true,
      data: topResults[0],
      topResults,
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);

    if (errorMsg.includes('Network') || errorMsg.includes('fetch') || errorMsg.includes('Failed to connect')) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Network connection failed. Please check your internet and try again.`,
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'api_error',
        message: `Identification failed: ${errorMsg.substring(0, 200)}`,
      },
    };
  }
}

// ============================================================
// Disease Identification
// ============================================================

/**
 * Identifies plant diseases from an image URI.
 * Should be called AFTER plant identification succeeds (sequentially).
 */
export async function identifyPlantDisease(
  imageUri: string
): Promise<
  | { success: true; data: DiseaseIdentificationResponse }
  | { success: false; error: PlantNetError }
> {
  try {
    if (!imageUri) {
      return {
        success: false,
        error: { type: 'api_error', message: 'No image provided for disease identification.' },
      };
    }

    const formData = new FormData();

    if (Platform.OS === 'web') {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      formData.append('images', blob, 'plant_disease.jpg');
    } else {
      formData.append('images', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'plant_disease.jpg',
      } as any);
    }

    const response = await fetch(DISEASE_ID_URL, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const statusCode = response.status;
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      // 404 means no diseases found — plant is healthy
      if (statusCode === 404) {
        return {
          success: true,
          data: { diseases: [], isHealthy: true },
        };
      }

      if (statusCode === 429) {
        return {
          success: false,
          error: {
            type: 'api_error',
            message: 'Too many requests. Please wait a moment and try again.',
          },
        };
      }

      if (statusCode >= 500) {
        return {
          success: false,
          error: {
            type: 'api_error',
            message: 'Disease identification service is temporarily unavailable.',
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Disease check failed (error ${statusCode}): ${errorBody.substring(0, 150) || 'Unknown error'}`,
        },
      };
    }

    const data = await response.json();

    // Parse diseases from the response
    const diseases: DiseaseResult[] = [];

    if (data.results && Array.isArray(data.results)) {
      for (const result of data.results) {
        const disease: DiseaseResult = {
          name:
            result.disease?.name ||
            result.name ||
            result.species?.commonNames?.[0] ||
            'Unknown condition',
          scientificName:
            result.disease?.scientificName ||
            result.species?.scientificNameWithoutAuthor ||
            undefined,
          confidence: result.score || result.confidence || 0,
          relatedImages: [],
          description: result.disease?.description || result.description || undefined,
        };

        // Extract related images from various possible response formats
        if (result.images && Array.isArray(result.images)) {
          disease.relatedImages = result.images
            .slice(0, 4)
            .map((img: any) => img?.url?.m || img?.url?.o || img?.m || img?.o || img?.url || '')
            .filter(Boolean);
        } else if (result.relatedImages && Array.isArray(result.relatedImages)) {
          disease.relatedImages = result.relatedImages.slice(0, 4);
        }

        if (disease.confidence > 0.01) {
          diseases.push(disease);
        }
      }
    }

    // Sort by confidence descending
    diseases.sort((a, b) => b.confidence - a.confidence);

    const isHealthy =
      diseases.length === 0 ||
      (diseases[0]?.name?.toLowerCase().includes('healthy'));

    return {
      success: true,
      data: { diseases, isHealthy },
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);

    if (errorMsg.includes('Network') || errorMsg.includes('fetch') || errorMsg.includes('Failed to connect')) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: 'Network connection failed during disease check. Please try again.',
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'api_error',
        message: `Disease identification failed: ${errorMsg.substring(0, 200)}`,
      },
    };
  }
}
