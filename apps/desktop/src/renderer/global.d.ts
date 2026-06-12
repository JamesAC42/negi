import type { MusicOsBridge } from "../preload/index.js";

declare global {
  interface Window {
    musicOs?: MusicOsBridge;
  }
}

export {};
