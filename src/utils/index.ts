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

const promptlayerApiHandler = async <Item>(
  body: TrackRequest & {
    request_response: AsyncIterable<Item> | any;
  }
) => {
  const isGenerator = body.request_response[Symbol.asyncIterator] !== undefined;
  if (isGenerator) {
    return proxyGenerator(body.request_response, body);
  }
  return await promptLayerApiRequest(body);
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
 * @param label The release label of a prompt you want to get. Setting this will supercede version
 */
const promptLayerGetPrompt = async (
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
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-KEY": api_key,
      },
    });
  } catch (e) {
    throw new Error(
      `PromptLayer had the following error while getting your prompt: ${e}`
    );
  }
  const data = await response.json();
  if (response.status !== 200) {
    raiseOnBadResponse(
      data,
      `PromptLayer had the following error while getting your prompt `
    );
  }
  return data;
};

const cleaned_result = (results: any[]) => {
  if ("text" in results[0].choices[0]) {
    let response = "";
    for (const result of results) {
      response = `${response}${result.choices[0].text}`;
    }
    const final_result = structuredClone(results.at(-1));
    final_result.choices[0].text = response;
    return final_result;
  } else if ("delta" in results[0].choices[0]) {
    let response = { role: "", content: "" };
    for (const result of results) {
      if ("role" in result.choices[0].delta) {
        response.role = result.choices[0].delta.role;
      }
      if ("content" in result.choices[0].delta) {
        response.content = `${response["content"]}${result.choices[0].delta.content}`;
      }
    }
    const final_result = structuredClone(results.at(-1));
    final_result.choices[0] = response;
    return final_result;
  }
  return "";
};

async function* proxyGenerator<Item>(
  generator: AsyncIterable<Item>,
  body: TrackRequest
) {
  const results = [];
  for await (const value of generator) {
    yield value;
    results.push(value);
  }
  const request_response = cleaned_result(results);
  const response = await promptLayerApiRequest({
    ...body,
    request_response,
    request_end_time: new Date().toISOString(),
  });
  yield response;
}

const raiseOnBadResponse = (request_response: any, main_message: string) => {
  if ("message" in request_response) {
    throw new Error(`${main_message}: ${request_response.message}`);
  }
  throw new Error(`${main_message}: ${request_response.message}`);
};

export {
  getApiKey,
  promptLayerApiRequest,
  promptLayerGetPrompt,
  promptlayerApiHandler,
};
