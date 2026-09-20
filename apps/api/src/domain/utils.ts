import { createHash, randomUUID, randomBytes } from "node:crypto";
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const token = () => randomBytes(32).toString("hex");
export const now = () => new Date().toISOString();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
