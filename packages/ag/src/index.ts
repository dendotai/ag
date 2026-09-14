// The package's public surface: what a project's `ag.config.ts` imports.
// Types only, plus the identity helper, so a consumer's type check pulls in
// nothing else of ag.

export interface ConvexConfig {
  /** The package that depends on `convex`, relative to the project root. */
  apiDir: string;
  team: string;
  project: string;
  /**
   * Passed to `convex deployment create --expiration` as is: "none",
   * "in 14 days", an ISO date, or a UNIX timestamp. Absent: Convex's default.
   */
  expiration?: string;
  /** Values to store on a fresh deployment before its first push. A value already stored is never touched. */
  env?: (tools: { secret: () => string }) => Record<string, string>;
  /** Env files to write once the deployment exists, keyed by path relative to the project root. */
  files?: (deployment: { url: string }) => Record<string, Record<string, string>>;
}

export interface AgConfig {
  adapter: "convex";
  convex?: ConvexConfig;
}

export function defineConfig(config: AgConfig): AgConfig {
  return config;
}
