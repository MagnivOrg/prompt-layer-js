import { track } from "@/types";
import {
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
} from "@/utils";

const metadata = (body: track.Metadata): Promise<boolean> => {
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

const score = (body: track.Score): Promise<boolean> => {
  if (typeof body.score !== "number") {
    throw new Error("Please provide a int score.");
  }
  if (body.score < 0 || body.score > 100) {
    throw new Error("Please provide a score between 0 and 100.");
  }
  return promptLayerTrackScore(body);
};

const prompt = (body: track.Prompt): Promise<boolean> => {
  if (!(body.prompt_input_variables instanceof Object)) {
    throw new Error("Please provide a dictionary of input variables.");
  }
  return promptLayerTrackPrompt(body);
};

const group = (body: track.Group) => promptLayerTrackGroup(body);

export { group, metadata, prompt, score };
