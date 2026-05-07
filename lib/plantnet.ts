/**
 * PlantNet API integration for plant identification.
 * Uses the PlantNet.org API to identify plants from images.
 *
 * Production APK Fix: Uses expo-file-system to read images as base64 before
 * creating Blobs, because fetch(file://) is unreliable in production Hermes builds.
 */

import { File as ExpoFile, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const PLANTNET_API_KEY = process.env.EXPO_PUBLIC_PLANTNET_API_KEY;
const PLANTNET_API_URL = `https://my-api.plantnet.org/v2/identify/all`;

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

interface PlantNetImage {
  o: string; // original URL
  m: string; // medium URL
  s: string; // small URL
}

interface PlantNetSpecies {
  scientificNameWithoutAuthor: string;
  scientificNameAuthorship: string;
  genus: { scientificNameWithoutAuthor: string };
  family: { scientificNameWithoutAuthor: string };
  commonNames: string[];
}

interface PlantNetAPIResult {
  score: number;
  species: PlantNetSpecies;
  images?: PlantNetImage[];
}

interface PlantNetAPIResponse {
  results: PlantNetAPIResult[];
  bestMatch?: string;
}

const MINIMUM_CONFIDENCE = 0.05; // 5% minimum confidence threshold
const REQUEST_TIMEOUT_MS = 60000; // 60 second timeout — PlantNet can take 10-30s with large images

/**
 * Converts a local image URI to a proper Blob for multipart form-data upload.
 *
 * In production APK builds (Hermes), fetch(file://) can fail silently or return
 * empty data. This function uses expo-file-system's new File API (v19+) which
 * implements Blob directly, or reads as base64 on native platforms.
 * On web, the standard fetch approach works fine.
 */
async function imageUriToBlob(imageUri: string): Promise<Blob> {
  if (!imageUri) {
    throw new Error('Image URI is empty or undefined — cannot read file for upload.');
  }

  // On web, fetch works fine with blob URIs and data URIs
  if (Platform.OS === 'web') {
    const response = await fetch(imageUri);
    return await response.blob();
  }

  // On native (Android/iOS), use expo-file-system to read the file reliably.
  // This is the critical fix for production APK builds where fetch(file://) fails.
  try {
    // Normalize the URI - ensure it has file:// prefix for FileSystem
    let normalizedUri = imageUri;
    if (!normalizedUri.startsWith('file://') && !normalizedUri.startsWith('content://') && !normalizedUri.startsWith('http')) {
      normalizedUri = `file://${normalizedUri}`;
    }

    // For content:// URIs (Android media picker), copy to a cache file first
    if (normalizedUri.startsWith('content://')) {
      const sourceFile = new ExpoFile(normalizedUri);
      const destFile = new ExpoFile(Paths.cache, `plantnet_upload_${Date.now()}.jpg`);
      await sourceFile.copy(destFile);
      normalizedUri = destFile.uri;
    }

    // Use the new expo-file-system File API to read as base64 (reliable in production)
    const file = new ExpoFile(normalizedUri);
    const base64Data = await file.base64();

    if (!base64Data || base64Data.length === 0) {
      throw new Error(`File read returned empty data. URI: ${normalizedUri.substring(0, 80)}`);
    }

    // Convert base64 to a byte array
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    if (byteArray.length === 0) {
      throw new Error(`Decoded image has 0 bytes. base64 length: ${base64Data.length}`);
    }

    // Determine MIME type from the URI
    const extension = imageUri.split('.').pop()?.toLowerCase()?.split('?')[0] || 'jpg';
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

    return new Blob([byteArray], { type: mimeType });
  } catch (fileSystemError: any) {
    // Fallback: try the fetch approach in case FileSystem fails
    // (e.g., for http:// URLs or data: URIs)
    console.warn('FileSystem read failed, falling back to fetch:', fileSystemError?.message);
    try {
      const response = await fetch(imageUri);
      if (!response.ok) {
        throw new Error(`fetch(imageUri) returned status ${response.status}`);
      }
      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('fetch(imageUri) returned empty blob');
      }
      return blob;
    } catch (fetchError: any) {
      throw new Error(
        `Failed to read image for upload. ` +
        `FileSystem error: ${fileSystemError?.message || 'unknown'}. ` +
        `Fetch fallback error: ${fetchError?.message || 'unknown'}. ` +
        `URI: ${imageUri.substring(0, 100)}`
      );
    }
  }
}

/**
 * Identifies a plant from a local image URI using the PlantNet API.
 * Returns the top 2 results with reference images for user comparison.
 */
export async function identifyPlantWithPlantNet(
  imageUri: string
): Promise<{ success: true; data: PlantNetResult; topResults: PlantNetResult[] } | { success: false; error: PlantNetError }> {
  if (!PLANTNET_API_KEY) {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'PlantNet API key is not configured.',
      },
    };
  }

  try {
    // Create form data with the image
    const formData = new FormData();

    // Get the file name from the URI (strip query params)
    const rawFileName = imageUri.split('/').pop()?.split('?')[0] || 'plant.jpg';
    const fileExtension = rawFileName.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `plant_id.${fileExtension}`;

    // Convert image URI to Blob for reliable cross-platform multipart upload
    const imageBlob = await imageUriToBlob(imageUri);
    formData.append('images', imageBlob, fileName);

    // Add organ parameter (leaf is the most common)
    formData.append('organs', 'auto');

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(
      `${PLANTNET_API_URL}?api-key=${PLANTNET_API_KEY}&include-related-images=true&no-reject=false&nb-results=5&lang=en`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const statusCode = response.status;
      // Try to read the error body for better diagnostics in production
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch { /* ignore */ }

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
            message: 'PlantNet service is temporarily unavailable. Please try again later.',
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Identification failed (error ${statusCode}): ${errorBody.substring(0, 100) || 'Unknown error'}`,
        },
      };
    }

    const data: PlantNetAPIResponse = await response.json();

    if (!data.results || data.results.length === 0) {
      return {
        success: false,
        error: {
          type: 'no_results',
          message: 'No plant species could be identified. Try taking a clearer photo with better lighting.',
        },
      };
    }

    const bestResult = data.results[0];

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
    const topResults: PlantNetResult[] = data.results.slice(0, 2).map((result) => {
      const commonNames = result.species.commonNames;
      const name = commonNames && commonNames.length > 0
        ? commonNames[0]
        : result.species.scientificNameWithoutAuthor;

      // Extract reference image URLs (use medium size for display)
      const refImages = (result.images || [])
        .slice(0, 3)
        .map((img) => img.m || img.o || img.s)
        .filter(Boolean);

      return {
        plantName: name,
        scientificName: result.species.scientificNameWithoutAuthor,
        confidence: result.score,
        family: result.species.family?.scientificNameWithoutAuthor || 'Unknown',
        genus: result.species.genus?.scientificNameWithoutAuthor || 'Unknown',
        referenceImages: refImages,
      };
    });

    return {
      success: true,
      data: topResults[0],
      topResults,
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return {
        success: false,
        error: {
          type: 'timeout',
          message: 'The request timed out after 60 seconds. This usually means the server is slow or the image is too large. Please try again with a smaller image or on a faster connection.',
        },
      };
    }

    const errorMsg = error?.message || String(error);
    const errorName = error?.name || 'Unknown';

    // Always include the actual error details so users/devs can diagnose
    if (errorMsg.includes('Network') || errorMsg.includes('fetch') || errorMsg.includes('Failed to connect')) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Connection failed: ${errorMsg.substring(0, 200)} [${errorName}]`,
        },
      };
    }

    // Surface the real error — don't hide it behind a generic message
    return {
      success: false,
      error: {
        type: 'api_error',
        message: `Identification failed: ${errorMsg.substring(0, 200)} [${errorName}]`,
      },
    };
  }
}

// ============================================================
// PlantNet Disease Identification API
// ============================================================

const PLANTNET_DISEASE_API_URL = 'https://my-api.plantnet.org/v2/diseases/identify';
const PLANTNET_DISEASE_API_KEY = '2b10FwLN1xs3J5l1EAgj8PKY3O';
const DISEASE_REQUEST_TIMEOUT_MS = 60000; // 60 seconds for disease identification

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

/**
 * Identifies plant diseases from a leaf image using the PlantNet Disease API.
 * Returns detected diseases ranked by confidence, with related reference images.
 * The image is properly converted to a Blob before sending as multipart form-data.
 */
export async function identifyPlantDisease(
  imageUri: string
): Promise<{ success: true; data: DiseaseIdentificationResponse } | { success: false; error: PlantNetError }> {
  try {
    const formData = new FormData();

    // Extract clean filename from URI (strip query params if present)
    const rawFileName = imageUri.split('/').pop()?.split('?')[0] || 'leaf.jpg';
    const fileExtension = rawFileName.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `plant_disease.${fileExtension}`;

    // Convert image URI to a proper Blob for reliable multipart form-data upload
    // This fixes 400 errors caused by improper file serialization on web
    const imageBlob = await imageUriToBlob(imageUri);
    formData.append('image', imageBlob, fileName);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISEASE_REQUEST_TIMEOUT_MS);

    const response = await fetch(
      `${PLANTNET_DISEASE_API_URL}?include-related-images=true&api-key=${PLANTNET_DISEASE_API_KEY}`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const statusCode = response.status;
      // Try to read the error body for production diagnostics
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch { /* ignore */ }

      if (statusCode === 404) {
        return {
          success: true,
          data: {
            diseases: [],
            isHealthy: true,
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
            message: 'Disease identification service is temporarily unavailable. Please try again later.',
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Disease identification failed (error ${statusCode}): ${errorBody.substring(0, 100) || 'Unknown error'}`,
        },
      };
    }

    const data = await response.json();

    // Parse the API response — handle various response formats
    const diseases: DiseaseResult[] = [];

    if (data.results && Array.isArray(data.results)) {
      for (const result of data.results) {
        const disease: DiseaseResult = {
          name: result.disease?.name || result.name || result.species?.commonNames?.[0] || 'Unknown condition',
          scientificName: result.disease?.scientificName || result.species?.scientificNameWithoutAuthor || undefined,
          confidence: result.score || result.confidence || 0,
          relatedImages: [],
          description: result.disease?.description || result.description || undefined,
        };

        // Extract related images
        if (result.images && Array.isArray(result.images)) {
          disease.relatedImages = result.images
            .slice(0, 4)
            .map((img: any) => img.url?.m || img.url?.o || img.m || img.o || img.url || '')
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

    const isHealthy = diseases.length === 0 || (diseases[0]?.name?.toLowerCase().includes('healthy'));

    return {
      success: true,
      data: {
        diseases,
        isHealthy,
      },
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return {
        success: false,
        error: {
          type: 'timeout',
          message: 'Disease identification timed out after 60 seconds. Try again with a smaller image or on a faster connection.',
        },
      };
    }

    const errorMsg = error?.message || String(error);
    const errorName = error?.name || 'Unknown';

    // Always surface the real error for production debugging
    if (errorMsg.includes('Network') || errorMsg.includes('fetch') || errorMsg.includes('Failed to connect')) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Disease check connection failed: ${errorMsg.substring(0, 200)} [${errorName}]`,
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'api_error',
        message: `Disease identification failed: ${errorMsg.substring(0, 200)} [${errorName}]`,
      },
    };
  }
}
