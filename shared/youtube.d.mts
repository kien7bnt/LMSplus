export declare const YOUTUBE_ALLOWED_HOSTS: readonly string[];

export declare function isValidYouTubeVideoId(id: unknown): id is string;

export declare function buildYouTubeEmbedUrl(videoId: string, startSeconds?: number): string;

export declare function buildYouTubeWatchUrl(videoId: string, startSeconds?: number): string;

export type YouTubeParseResult =
  | {
      ok: true;
      videoId: string;
      startSeconds: number;
      embedUrl: string;
      watchUrl: string;
      thumbnailUrl: string;
    }
  | {
      ok: false;
      error: 'EMPTY_URL' | 'INVALID_URL' | 'DOMAIN_NOT_ALLOWED' | 'INVALID_VIDEO_ID';
      message: string;
    };

export declare function parseYouTubeUrl(input: string): YouTubeParseResult;
