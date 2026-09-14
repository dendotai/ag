// The package's public surface: what a project's `ag.config.ts` imports.
// Types only, plus the identity helper, so a consumer's type check pulls in
// nothing else of ag.

/** What `convex deployment create --expiration` accepts. Convex requires 30 minutes to 1 year from now. */
export type ConvexExpiration =
  | "none"
  | `in ${number} ${"minute" | "minutes" | "hour" | "hours" | "day" | "days"}`
  | `${number}-${number}-${number}T${number}:${number}:${number}Z`
  /** A UNIX timestamp, in seconds or milliseconds. */
  | number;

export interface ConvexConfig {
  /** The package that depends on `convex`, relative to the project root. */
  apiDir: string;
  team: string;
  project: string;
  /**
   * Absent: no expiration, the deployment stays until something deletes it.
   * That is Convex's behaviour for dev deployments as of CLI 1.45; only
   * preview deployments expire on their own.
   */
  expiration?: ConvexExpiration;
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
