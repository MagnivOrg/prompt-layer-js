// import { openai } from "./index";
import { openai } from "./index";

(async () => {    
    const chatCompletion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [{role: "user", content: "Hello world"}],
    });
    console.log(chatCompletion?.data?.choices?.[0]?.message ?? "No message found");
})();