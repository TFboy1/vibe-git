export type InterventionMode = "assisted" | "automatic";
export interface CollaborationPreference {
  mode: InterventionMode;
  configured: boolean;
}
