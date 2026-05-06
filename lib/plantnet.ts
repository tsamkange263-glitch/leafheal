/**
 * PlantNet API integration for plant identification.
 * Uses the PlantNet.org API to identify plants from images.
 */

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
const REQUEST_TIMEOUT_MS = 25000; // 25 second timeout

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

    // Get the file name from the URI
    const fileName = imageUri.split('/').pop() || 'plant.jpg';
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';

    // Append the image as a file to the form data
    formData.append('images', {
      uri: imageUri,
      name: fileName,
      type: mimeType,
    } as any);

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
          message: `Identification failed (error ${statusCode}). Please try again.`,
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
          message: 'The identification request timed out. Please check your internet connection and try again.',
        },
      };
    }

    if (error?.message?.includes('Network') || error?.message?.includes('fetch')) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: 'Network error. Please check your internet connection and try again.',
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'An unexpected error occurred during identification. Please try again.',
      },
    };
  }
}
