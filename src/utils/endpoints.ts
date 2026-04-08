export const skillCollectionsEndpoint = (baseURL: string): string =>
  `${baseURL}/api/public/v2/skill-collections`;

export const skillCollectionEndpoint = (
  baseURL: string,
  identifier: string
): string => `${skillCollectionsEndpoint(baseURL)}/${encodeURIComponent(identifier)}`;

export const skillCollectionVersionsEndpoint = (
  baseURL: string,
  identifier: string
): string => `${skillCollectionEndpoint(baseURL, identifier)}/versions`;
