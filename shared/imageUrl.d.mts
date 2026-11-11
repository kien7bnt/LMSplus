export function isSafeImageDataUrl(input: unknown, maxChars?: number): boolean;

export function extractImageUrlCandidates(input: string | null | undefined): string[];

export type NormalizedImageUrlResult =
  | {
      ok: true;
      url: string;
      candidates: string[];
      unwrapped: boolean;
      isDataUrl: boolean;
    }
  | {
      ok: false;
      error: 'EMPTY_URL' | 'INVALID_IMAGE_URL' | 'DATA_URL_NOT_ALLOWED' | 'IMAGE_TOO_LARGE';
      message: string;
    };

export function normalizeImageUrl(
  input: unknown,
  opts?: { allowDataUrl?: boolean; maxDataUrlChars?: number; upgradeHttp?: boolean }
): NormalizedImageUrlResult;
