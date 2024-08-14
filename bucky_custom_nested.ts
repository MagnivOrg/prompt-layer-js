import { PromptLayer } from "@/index";

const promptlayer = new PromptLayer({
  apiKey: process.env.PROMPTLAYER_API_KEY,
  enableTracing: true
});

async function calculateProduct(a: number, b: number) {
  console.log(`Calculating product of ${a} and ${b}`);
  await new Promise(resolve => setTimeout(resolve, 500));
  return a * b;
}

async function calculateAndDouble(x: number, y: number) {
  console.log(`Calculating and doubling for ${x} and ${y}`);
  const product = await wrappedCalculateProduct(x, y);
  await new Promise(resolve => setTimeout(resolve, 500));
  return product * 2;
}

const wrappedCalculateProduct = promptlayer.wrapWithSpan('calculateProduct', calculateProduct);
const wrappedCalculateAndDouble = promptlayer.wrapWithSpan('calculateAndDouble', calculateAndDouble);

async function main() {
  try {
    console.log("Starting custom function execution...");
    const param1 = 5;
    const param2 = 7;
    console.log(`Calling function with parameters: ${param1}, ${param2}`);
    const result = await wrappedCalculateAndDouble(param1, param2);
    console.log("Final result:", result);
    console.log("Custom function execution completed successfully.");
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

main().then(() => console.log("Script execution completed."));
