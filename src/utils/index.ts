import promptlayer from "@/promptlayer";
import { TrackRequest } from "@/types";

const URL_API_PROMPTLAYER = "https://api.promptlayer.com";

const getApiKey = () => {
  if (promptlayer.api_key === undefined) {
    throw new Error(
      "Please set your PROMPTLAYER_API_KEY environment variable or set API KEY in code using 'promptlayer.api_key = <your_api_key>' "
    );
  } else {
    return promptlayer.api_key;
  }
};

const promptLayerApiRequest = async (body: TrackRequest) => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      console.warn(
        `WARNING: While logging your request PromptLayer had the following error: ${JSON.stringify(
          data
        )}`
      );
    }
    if (data && body.return_pl_id) {
      return [body.request_response, data.request_id];
    }
    return body.request_response;
  } catch (e) {
    console.warn(
      `WARNING: While logging your request PromptLayer had the following error: ${e}`
    );
  }
};

/**
 * Get a prompt from the PromptLayer library
 * @param prompt_name name of the prompt to get
 * @param api_key your api key
 * @param version version of the prompt to get, None for latest
 * @param label The specific label of a prompt you want to get. Setting this will supercede version
 */
const promptLayerGetPrompt = (
  prompt_name: string,
  api_key: string,
  version?: number,
  label?: string
) => {
  const params: Record<string, string> = {
    prompt_name,
    version: version?.toString() ?? "",
    label: label ?? "",
  };
  const url = new URL(`${URL_API_PROMPTLAYER}/library-get-prompt-template`);
  url.search = new URLSearchParams(params).toString();
  return fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-KEY": api_key,
    },
  })
    .then((response) => {
      if (response.status !== 200) {
        throw new Error(
          `PromptLayer had the following error while getting your prompt: ${response}`
        );
      }
      return response.json();
    })
    .catch((e) => {
      throw new Error(
        `PromptLayer had the following error while getting your prompt: ${e}`
      );
    });
};

export { getApiKey, promptLayerApiRequest, promptLayerGetPrompt };
