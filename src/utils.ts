import promptlayer from "@/promptlayer";
import {
  GetPromptTemplate,
  PublishPromptTemplate,
  TrackGroup,
  TrackMetadata,
  TrackPrompt,
  TrackRequest,
  TrackScore,
} from "@/types";

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
      warnOnBadResponse(
        data,
        "WARNING: While logging your request, PromptLayer experienced the following error:"
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
const promptLayerGetPrompt = async (body: GetPromptTemplate) => {
  const params: Record<string, string> = {
    prompt_name: body.prompt_name,
    version: body.version?.toString() ?? "",
    label: body.label ?? "",
  };
  const url = new URL(`${URL_API_PROMPTLAYER}/library-get-prompt-template`);
  url.search = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-KEY": getApiKey(),
      },
    });
  } catch (e) {
    throw new Error(
      `PromptLayer had the following error while getting your prompt: ${e}`
    );
  }
  const data = await response.json();
  if (response.status !== 200) {
    throwOnBadResponse(
      data,
      `PromptLayer had the following error while retrieving your prompt template`
    );
  }
  return data;
};

const promptLayerPublishPrompt = async (
  body: PublishPromptTemplate
): Promise<boolean> => {
  let response: Response;
  try {
    response = await fetch(
      `${URL_API_PROMPTLAYER}/library-publish-prompt-template`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          api_key: getApiKey(),
        }),
      }
    );
  } catch (e) {
    throw new Error(
      `PromptLayer had the following error while publishing your prompt template: ${e}`
    );
  }
  const data = await response.json();
  if (response.status !== 200) {
    throwOnBadResponse(
      data,
      `PromptLayer had the following error while publishing your prompt`
    );
  }
  return true;
};

const promptLayerTrackMetadata = async (
  body: TrackMetadata
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/library-track-metadata`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          api_key: getApiKey(),
        }),
      }
    );
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While logging metadata to your request, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While logging metadata to your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackScore = async (body: TrackScore): Promise<boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/library-track-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        api_key: getApiKey(),
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While scoring your request, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While scoring your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackPrompt = async (body: TrackPrompt): Promise<boolean> => {
  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/library-track-prompt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          api_key: getApiKey(),
        }),
      }
    );
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While associating your request with a prompt template, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While associating your request with a prompt template, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackGroup = async (body: TrackGroup): Promise<boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/track-group`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        api_key: getApiKey(),
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While associating your request with a group, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While associating your request with a group, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerCreateGroup = async (): Promise<number | boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/create-group`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: getApiKey(),
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While creating a group PromptLayer had the following error"
      );
      return false;
    }
    return data.id;
  } catch (e) {
    console.warn(
      `WARNING: While creating a group PromptLayer had the following error: ${e}`
    );
    return false;
  }
};

const cleaned_result = (results: any[]) => {
  if ("completion" in results[0])
    return results.reduce(
      (prev, current) => ({
        ...current,
        completion: `${prev.completion}${current.completion}`,
      }),
      {}
    );
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

const warnOnBadResponse = (request_response: any, main_message: string) => {
  try {
    console.warn(`${main_message}: ${request_response.message}`);
  } catch (e) {
    console.warn(`${main_message}: ${request_response}`);
  }
};

const throwOnBadResponse = (request_response: any, main_message: string) => {
  if ("message" in request_response) {
    throw new Error(`${main_message}: ${request_response.message}`);
  }
  throw new Error(`${main_message}: ${request_response.message}`);
};

export {
  getApiKey,
  promptLayerApiRequest,
  promptLayerCreateGroup,
  promptLayerGetPrompt,
  promptLayerPublishPrompt,
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
  promptlayerApiHandler,
};
