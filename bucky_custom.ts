import { PromptLayer } from "@/index";

const promptlayer = new PromptLayer({
  apiKey: process.env.PROMPTLAYER_API_KEY,
  enableTracing: true
});

async function myCustomFunction(param1: number, param2: number) {
  console.log(`Function called with parameters: ${param1}, ${param2}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const result = param1 * param2;
  console.log(`Calculation result: ${result}`);
  return result;
}

const wrappedFunction = promptlayer.wrapWithSpan('myCustomFunction', myCustomFunction);

async function main() {
  try {
    console.log("Starting custom function execution...");
    const param1 = 5;
    const param2 = 7;
    console.log(`Calling function with parameters: ${param1}, ${param2}`);
    const result = await wrappedFunction(param1, param2);
    console.log("Custom function result:", result);
    console.log("Custom function execution completed successfully.");
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

main().then(() => console.log("Script execution completed."));
