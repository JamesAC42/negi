import { contextBridge, ipcRenderer } from "electron";
import { healthResponseSchema, type HealthResponse } from "@music-os/core";

const backendHost = process.env.MUSIC_OS_HOST ?? "127.0.0.1";
const backendPort = Number(process.env.MUSIC_OS_PORT ?? 47831);

export interface BackgroundImageSelection {
  path: string;
  url: string;
}

export interface MusicOsBridge {
  health(): Promise<HealthResponse>;
  selectLibraryFolder(): Promise<string | null>;
  selectImportFiles(): Promise<string[]>;
  selectImportFolder(): Promise<string[]>;
  selectBackgroundImage(): Promise<BackgroundImageSelection | null>;
}

const bridge: MusicOsBridge = {
  async health() {
    const response = await fetch(`http://${backendHost}:${backendPort}/health`);
    if (!response.ok) {
      throw new Error(`Backend health failed with ${response.status}`);
    }
    return healthResponseSchema.parse(await response.json());
  },
  async selectLibraryFolder() {
    return ipcRenderer.invoke("dialog:select-library-folder") as Promise<string | null>;
  },
  async selectImportFiles() {
    return ipcRenderer.invoke("dialog:select-import-files") as Promise<string[]>;
  },
  async selectImportFolder() {
    return ipcRenderer.invoke("dialog:select-import-folder") as Promise<string[]>;
  },
  async selectBackgroundImage() {
    return ipcRenderer.invoke("dialog:select-background-image") as Promise<BackgroundImageSelection | null>;
  }
};

contextBridge.exposeInMainWorld("musicOs", bridge);
