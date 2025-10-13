import { TrackGroup, TrackMetadata, TrackPrompt, TrackScore } from "@/types";
import {
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
} from "@/utils/utils";

const metadata = (apiKey: string, body: TrackMetadata, throwOnError: boolean = true): Promise<boolean> => {
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
  return promptLayerTrackMetadata(apiKey, body, throwOnError);
};

const score = (apiKey: string, body: TrackScore, throwOnError: boolean = true): Promise<boolean> => {
  if (typeof body.score !== "number") {
    throw new Error("Score must be a number");
  }
  if (body.score < 0 || body.score > 100) {
    throw new Error("Score must be a number between 0 and 100.");
  }
  return promptLayerTrackScore(apiKey, body, throwOnError);
};

const prompt = (apiKey: string, body: TrackPrompt, throwOnError: boolean = true): Promise<boolean> => {
  if (!(body.prompt_input_variables instanceof Object)) {
    throw new Error("Prompt template input variable dictionary not provided.");
  }
  return promptLayerTrackPrompt(apiKey, body, throwOnError);
};

const group = (apiKey: string, body: TrackGroup, throwOnError: boolean = true) =>
  promptLayerTrackGroup(apiKey, body, throwOnError);

export class TrackManager {
  apiKey: string;
  throwOnError: boolean;

  constructor(apiKey: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.throwOnError = throwOnError;
  }

  group = (body: TrackGroup) => group(this.apiKey, body, this.throwOnError);

  metadata = (body: TrackMetadata) => metadata(this.apiKey, body, this.throwOnError);

  prompt = (body: TrackPrompt) => prompt(this.apiKey, body, this.throwOnError);

  score = (body: TrackScore) => score(this.apiKey, body, this.throwOnError);
}
