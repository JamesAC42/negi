export interface ConnectorHealth {
  ok: boolean;
  message?: string;
}

export interface SourceSearchQuery {
  query: string;
  filters?: Record<string, unknown>;
}

export interface SourceSearchResult {
  connector: string;
  externalId: string;
  title: string;
  artist?: string;
  album?: string;
  year?: number;
  format?: string;
  quality?: Record<string, unknown>;
  sizeBytes?: number;
  durationMs?: number;
  confidence?: number;
  warnings?: string[];
  raw: unknown;
}

export interface SourceSearchResultDetail extends SourceSearchResult {
  tracks?: Array<{ title: string; durationMs?: number }>;
}

export interface DownloadOptions {
  destinationStagingPath?: string;
}

export interface DownloadJobRef {
  connector: string;
  jobId: string;
}

export interface DownloadJobStatus {
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  destinationStagingPath?: string;
}

export interface MusicSourceConnector {
  name: string;
  testConnection(): Promise<ConnectorHealth>;
  search(query: SourceSearchQuery): Promise<SourceSearchResult[]>;
  getResult?(id: string): Promise<SourceSearchResultDetail>;
  queueDownload?(resultId: string, options: DownloadOptions): Promise<DownloadJobRef>;
  getDownloadStatus?(jobId: string): Promise<DownloadJobStatus>;
}
