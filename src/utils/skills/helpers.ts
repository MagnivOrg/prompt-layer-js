import { SkillCollectionZipSource } from "@/types";

export const omitUndefined = <T extends Record<string, unknown>>(
  obj: T,
): Partial<T> =>
  Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

export const parseSkillResponseData = async (
  response: Response,
): Promise<any> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

export const toZipBlob = (source: SkillCollectionZipSource): Blob => {
  if (source instanceof Blob) {
    return source;
  }

  if (source instanceof Uint8Array) {
    return new Blob(
      [
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ) as ArrayBuffer,
      ],
      { type: "application/zip" },
    );
  }

  return new Blob([source], { type: "application/zip" });
};
