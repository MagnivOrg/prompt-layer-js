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

export { getApiKey, promptLayerApiRequest };
