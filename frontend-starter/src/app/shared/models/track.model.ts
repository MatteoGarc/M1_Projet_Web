/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  /** Présent dans les réponses du backend, jamais affiché. */
  ownerId?: string;
  title: string;
  originalName: string;
  mimeType: string;
  /** Taille en octets. */
  size: number;
  createdAt: string;
}
