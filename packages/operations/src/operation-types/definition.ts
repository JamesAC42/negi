import type { ZodSchema } from "zod";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface OperationDefinition<TPayload> {
  type: string;
  riskLevel: "low" | "medium" | "high" | "dangerous";
  schema: ZodSchema<TPayload>;
  captureBefore(payload: TPayload): Promise<unknown>;
  validate(payload: TPayload): Promise<ValidationResult>;
  apply(payload: TPayload): Promise<unknown>;
  revert?(payload: TPayload, before: unknown): Promise<unknown>;
}
