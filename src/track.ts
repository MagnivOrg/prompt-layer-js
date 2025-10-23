import { TrackGroup, TrackMetadata, TrackPrompt, TrackScore } from "@/types";
import {
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
} from "@/utils/utils";

const metadata = (
  apiKey: string,
  baseURL: string,
  body: TrackMetadata,
  throwOnError: boolean = true
): Promise<boolean> => {
  if (!(body.metadata instanceof Object)) {
    throw new Error("Please provide a dictionary of metadata.");
  }
  for (const [key, value] of Object.entries(body.metadata)) {
    if (typeof key !== "string" || typeof value !== "string") {
      throw new Error(
        "Please provide a dictionary of metadata with key value pair of strings."
      );
    }
  }
  return promptLayerTrackMetadata(apiKey, baseURL, body, throwOnError);
};

const score = (
  apiKey: string,
  baseURL: string,
  body: TrackScore,
  throwOnError: boolean = true
): Promise<boolean> => {
  if (typeof body.score !== "number") {
    throw new Error("Score must be a number");
  }
  if (body.score < 0 || body.score > 100) {
    throw new Error("Score must be a number between 0 and 100.");
  }
  return promptLayerTrackScore(apiKey, baseURL, body, throwOnError);
};

const prompt = (
  apiKey: string,
  baseURL: string,
  body: TrackPrompt,
  throwOnError: boolean = true
): Promise<boolean> => {
  if (!(body.prompt_input_variables instanceof Object)) {
    throw new Error("Prompt template input variable dictionary not provided.");
  }
  return promptLayerTrackPrompt(apiKey, baseURL, body, throwOnError);
};

const group = (
  apiKey: string,
  baseURL: string,
  body: TrackGroup,
  throwOnError: boolean = true
) => promptLayerTrackGroup(apiKey, baseURL, body, throwOnError);

export class TrackManager {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;

  constructor(apiKey: string, baseURL: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.throwOnError = throwOnError;
  }

  group = (body: TrackGroup) =>
    group(this.apiKey, this.baseURL, body, this.throwOnError);

  metadata = (body: TrackMetadata) =>
    metadata(this.apiKey, this.baseURL, body, this.throwOnError);

  prompt = (body: TrackPrompt) =>
    prompt(this.apiKey, this.baseURL, body, this.throwOnError);

  score = (body: TrackScore) =>
    score(this.apiKey, this.baseURL, body, this.throwOnError);
}
