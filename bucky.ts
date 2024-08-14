import BaseOpenAI from "openai";
import { PromptLayer } from "@/index";

const promptlayer = new PromptLayer({
    apiKey: process.env.PROMPTLAYER_API_KEY
});

// const OpenAI: typeof BaseOpenAI = promptlayer.OpenAI;
// const openai = new OpenAI();
//
// openai.chat.completions.create({
//     messages: [{ role: "user", content: "Sup bra?" }],
//     model: "gpt-3.5-turbo",
//     // @ts-ignore
//     pl_tags: ["test"],
// });

const runPromptExample = async () => {
    try {
        const result = await promptlayer.run({
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
        console.log(result);
    } catch (error) {
        console.error("Error running prompt:", error);
    }
}

// Execute the example
runPromptExample();
