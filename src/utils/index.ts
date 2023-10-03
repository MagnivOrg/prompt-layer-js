import { TrackRequest } from "@/types";

const URL_API_PROMPTLAYER =
  process.env.URL_API_PROMPTLAYER || "https://api.promptlayer.com";

const promptlayerApiRequest = async (body: TrackRequest) => {
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
      return data.request_id;
    }
  } catch (e) {
    console.warn(
      `WARNING: While logging your request PromptLayer had the following error: ${e}`
    );
  }
};

export { promptlayerApiRequest };
