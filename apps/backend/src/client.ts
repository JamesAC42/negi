import { healthResponseSchema, type HealthResponse } from "@music-os/core";
import type { BackendConfig } from "./config.js";

export async function getHealth(config: Pick<BackendConfig, "host" | "port">): Promise<HealthResponse> {
  const response = await fetch(`http://${config.host}:${config.port}/health`);
  if (!response.ok) {
    throw new Error(`Backend health failed with ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
