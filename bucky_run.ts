import {PromptLayer} from "@/index";

const promptlayer = new PromptLayer({
  apiKey: process.env.PROMPTLAYER_API_KEY
});

const runPromptExample = async () => {
  try {
    await promptlayer.run({
      promptName: "ai-poet",
      inputVariables: {
        topic: "beans"
      },
      tags: ["geography", "test"],
      metadata: {
        user_id: "12345",
        session_id: "abcde"
      },
      stream: false
    });
  } catch (error) {
    console.error("Error running prompt:", error);
  }
}

runPromptExample();
