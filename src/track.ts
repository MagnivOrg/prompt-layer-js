import { TrackGroup, TrackMetadata, TrackPrompt, TrackScore } from "@/types";
import {
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
} from "@/utils";

const metadata = (body: TrackMetadata): Promise<boolean> => {
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
  return promptLayerTrackMetadata(body);
};

const score = (body: TrackScore): Promise<boolean> => {
  if (typeof body.score !== "number") {
    throw new Error("Score must be a number");
  }
  if (body.score < 0 || body.score > 100) {
    throw new Error("Score must be a number between 0 and 100.");
  }
  return promptLayerTrackScore(body);
};

const prompt = (body: TrackPrompt): Promise<boolean> => {
  if (!(body.prompt_input_variables instanceof Object)) {
    throw new Error("Prompt template input variable dictionary not provided.");
  }
  return promptLayerTrackPrompt(body);
};

const group = (body: TrackGroup) => promptLayerTrackGroup(body);

export { group, metadata, prompt, score };
