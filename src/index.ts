import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const target = new OpenAIApi(configuration);

export const openai = new Proxy(target, {
  get: (target, prop, receiver) => {
    const value = target[prop as keyof OpenAIApi];
    if (typeof value === "function") {
      return (...args: any[]) => {
        let return_pl_id = false;
        const newArgs = args.map((arg) => {
          if (arg["return_pl_id"] !== undefined) {
            return_pl_id = arg["return_pl_id"];
            delete arg["return_pl_id"];
          }
          return arg;
        });
        return (value as any).apply(target, args);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
