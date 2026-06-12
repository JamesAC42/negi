import { parseFile } from "music-metadata";
import type { ImportItem, MetadataDiagnosticsResponse } from "@music-os/core";
import type { LibraryRepository } from "./library-repository.js";

export async function inspectLibraryFile(
  library: LibraryRepository,
  fileId: string
): Promise<MetadataDiagnosticsResponse> {
  const file = library.getFile(fileId);
  return {
    ...(await inspectPath(file.path)),
    source: "library_file",
    fileId,
    importItemId: null,
    indexedDisplayTags: file.displayTags,
    importContext: null
  };
}

export async function inspectImportItem(item: ImportItem): Promise<MetadataDiagnosticsResponse> {
  return {
    ...(await inspectPath(item.stagingPath)),
    source: "import_item",
    fileId: item.fileId,
    importItemId: item.id,
    indexedDisplayTags: {},
    importContext: {
      detectedArtist: item.detectedArtist,
      detectedAlbum: item.detectedAlbum,
      detectedTitle: item.detectedTitle,
      detectedYear: item.detectedYear,
      selectedCandidate: item.selectedCandidate,
      metadataCandidates: item.metadataCandidates,
      warnings: item.warnings
    }
  };
}

async function inspectPath(path: string): Promise<Omit<MetadataDiagnosticsResponse, "source" | "fileId" | "importItemId" | "indexedDisplayTags" | "importContext">> {
  try {
    const metadata = await parseFile(path, { duration: true, skipCovers: true });
    return {
      path,
      parserStatus: "ok",
      error: null,
      format: compactFormat(metadata.format as unknown as Record<string, unknown>),
      common: Object.entries(metadata.common)
        .flatMap(([key, value]) => stringifyTagValues(value).map((tagValue) => ({ key, value: tagValue })))
        .sort((left, right) => left.key.localeCompare(right.key)),
      native: Object.entries(metadata.native)
        .flatMap(([source, tags]) =>
          tags.flatMap((tag) => stringifyTagValues(tag.value).map((value) => ({ source, key: tag.id, value })))
        )
        .sort((left, right) => `${left.source}:${left.key}`.localeCompare(`${right.source}:${right.key}`))
    };
  } catch (error) {
    return {
      path,
      parserStatus: "error",
      error: error instanceof Error ? error.message : String(error),
      format: {},
      common: [],
      native: []
    };
  }
}

function compactFormat(format: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(format)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    }
  }
  return result;
}

function stringifyTagValues(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringifyTagValues(item));
  }

  if (typeof value === "object") {
    if ("format" in value && "data" in value) {
      return ["[binary artwork omitted]"];
    }
    return [truncate(JSON.stringify(value))];
  }

  return [truncate(String(value))];
}

function truncate(value: string): string {
  return value.length > 600 ? `${value.slice(0, 600)}...` : value;
}
