import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const CACHE_KEY = 'herbal_pdf_reference_cache';
const CACHE_TIMESTAMP_KEY = 'herbal_pdf_reference_timestamp';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedReference {
  fileName: string;
  text: string;
}

interface HerbalReferenceCache {
  references: CachedReference[];
  totalChars: number;
}

/**
 * Fetches herbal reference text from the herbal_pdf_cache table in Supabase.
 * Caches locally in AsyncStorage with a 24-hour TTL.
 * Gracefully degrades — returns empty string if anything fails.
 */
export async function getHerbalReferenceContext(): Promise<string> {
  try {
    // Check if local cache is still valid
    const cachedData = await getLocalCache();
    if (cachedData) {
      return formatReferenceContext(cachedData);
    }

    // Fetch fresh data from Supabase
    const freshData = await fetchFromSupabase();
    if (freshData && freshData.references.length > 0) {
      await saveLocalCache(freshData);
      return formatReferenceContext(freshData);
    }

    return '';
  } catch (error) {
    console.error('[HerbalReference] Failed to get reference context:', error);
    return '';
  }
}

/**
 * Forces a refresh of the herbal reference cache.
 * Call this on app startup or when user manually triggers a refresh.
 */
export async function refreshHerbalReferenceCache(): Promise<boolean> {
  try {
    const freshData = await fetchFromSupabase();
    if (freshData && freshData.references.length > 0) {
      await saveLocalCache(freshData);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[HerbalReference] Failed to refresh cache:', error);
    return false;
  }
}

/**
 * Checks if the cache needs refreshing (older than 24 hours).
 */
export async function shouldRefreshCache(): Promise<boolean> {
  try {
    const timestamp = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return true;

    const cacheAge = Date.now() - parseInt(timestamp, 10);
    return cacheAge > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

/**
 * Clears the local herbal reference cache.
 */
export async function clearHerbalReferenceCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([CACHE_KEY, CACHE_TIMESTAMP_KEY]);
  } catch (error) {
    console.error('[HerbalReference] Failed to clear cache:', error);
  }
}

// ---- Private helpers ----

async function getLocalCache(): Promise<HerbalReferenceCache | null> {
  try {
    const timestamp = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return null;

    const cacheAge = Date.now() - parseInt(timestamp, 10);
    if (cacheAge > CACHE_TTL_MS) return null;

    const data = await AsyncStorage.getItem(CACHE_KEY);
    if (!data) return null;

    return JSON.parse(data) as HerbalReferenceCache;
  } catch {
    return null;
  }
}

async function fetchFromSupabase(): Promise<HerbalReferenceCache | null> {
  try {
    const { data, error } = await supabase
      .from('herbal_pdf_cache')
      .select('file_name, extracted_text')
      .order('file_name');

    if (error || !data || data.length === 0) {
      // Try triggering extraction if no cached data exists
      await triggerExtraction();
      // Retry fetch
      const { data: retryData, error: retryError } = await supabase
        .from('herbal_pdf_cache')
        .select('file_name, extracted_text')
        .order('file_name');

      if (retryError || !retryData || retryData.length === 0) {
        return null;
      }

      const references = retryData.map(row => ({
        fileName: row.file_name,
        text: row.extracted_text,
      }));

      return {
        references,
        totalChars: references.reduce((sum, r) => sum + r.text.length, 0),
      };
    }

    const references = data.map(row => ({
      fileName: row.file_name,
      text: row.extracted_text,
    }));

    return {
      references,
      totalChars: references.reduce((sum, r) => sum + r.text.length, 0),
    };
  } catch {
    return null;
  }
}

async function triggerExtraction(): Promise<void> {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;

    await fetch(`${supabaseUrl}/functions/v1/extract-pdf-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // Silently fail — this is a best-effort background operation
  }
}

async function saveLocalCache(data: HerbalReferenceCache): Promise<void> {
  try {
    // Trim text to fit within AsyncStorage limits (typically 6MB)
    // Keep max ~3MB of reference text total
    const MAX_TOTAL_CHARS = 3_000_000;
    let totalChars = 0;
    const trimmedRefs: CachedReference[] = [];

    for (const ref of data.references) {
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining <= 0) break;

      const trimmedText = ref.text.substring(0, remaining);
      trimmedRefs.push({ fileName: ref.fileName, text: trimmedText });
      totalChars += trimmedText.length;
    }

    const cacheData: HerbalReferenceCache = {
      references: trimmedRefs,
      totalChars,
    };

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (error) {
    console.error('[HerbalReference] Failed to save cache:', error);
  }
}

function formatReferenceContext(cache: HerbalReferenceCache): string {
  if (!cache.references.length) return '';

  // Build a condensed reference context string for the AI prompt
  // Limit total context to ~15000 chars to avoid overwhelming the AI prompt
  const MAX_CONTEXT_CHARS = 15000;
  let context = '';

  for (const ref of cache.references) {
    const sourceName = ref.fileName
      .replace(/-/g, ' ')
      .replace('.pdf', '')
      .replace(/\b\w/g, c => c.toUpperCase());

    const section = `\n--- Source: ${sourceName} ---\n${ref.text}\n`;

    if (context.length + section.length > MAX_CONTEXT_CHARS) {
      // Add as much as we can from this reference
      const remaining = MAX_CONTEXT_CHARS - context.length;
      if (remaining > 200) {
        context += `\n--- Source: ${sourceName} ---\n${ref.text.substring(0, remaining - 100)}\n[...truncated]\n`;
      }
      break;
    }

    context += section;
  }

  return context;
}

/**
 * Performs a targeted lookup in the cached herbal reference data for a specific plant.
 * Instead of sending all 7 books to the AI, this extracts only passages
 * mentioning the identified plant name (common or scientific).
 * Returns a condensed, relevant excerpt (max ~4000 chars).
 */
export async function getTargetedPlantReference(
  plantName: string,
  scientificName?: string | null
): Promise<string> {
  try {
    const cachedData = await getLocalCache();
    if (!cachedData || !cachedData.references.length) return '';

    const searchTerms = [plantName.toLowerCase()];
    if (scientificName) {
      searchTerms.push(scientificName.toLowerCase());
      // Also add genus name (first word of scientific name)
      const genus = scientificName.split(' ')[0];
      if (genus && genus.length > 3) {
        searchTerms.push(genus.toLowerCase());
      }
    }
    // Add common alternate name patterns
    const nameWords = plantName.toLowerCase().split(' ');
    if (nameWords.length > 1) {
      nameWords.forEach(word => {
        if (word.length > 3) searchTerms.push(word);
      });
    }

    const MAX_TARGETED_CHARS = 4000;
    let targetedContext = '';

    for (const ref of cachedData.references) {
      const text = ref.text;
      const lines = text.split('\n');
      const relevantLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const lineLower = lines[i].toLowerCase();
        const isRelevant = searchTerms.some(term => lineLower.includes(term));

        if (isRelevant) {
          // Include surrounding context (2 lines before, 4 lines after)
          const startIdx = Math.max(0, i - 2);
          const endIdx = Math.min(lines.length - 1, i + 4);
          for (let j = startIdx; j <= endIdx; j++) {
            if (!relevantLines.includes(lines[j])) {
              relevantLines.push(lines[j]);
            }
          }
        }
      }

      if (relevantLines.length > 0) {
        const sourceName = ref.fileName
          .replace(/-/g, ' ')
          .replace('.pdf', '')
          .replace(/\b\w/g, c => c.toUpperCase());

        const section = `\n[${sourceName}]: ${relevantLines.join('\n')}\n`;

        if (targetedContext.length + section.length > MAX_TARGETED_CHARS) {
          const remaining = MAX_TARGETED_CHARS - targetedContext.length;
          if (remaining > 100) {
            targetedContext += section.substring(0, remaining) + '\n[...truncated]';
          }
          break;
        }
        targetedContext += section;
      }
    }

    return targetedContext;
  } catch (error) {
    console.error('[HerbalReference] Targeted lookup failed:', error);
    return '';
  }
}
