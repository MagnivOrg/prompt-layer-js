import { Configuration, OpenAIApi } from "openai";
import { TrackRequestAudit } from "./interfaces/TrackRequestAudit";
const dotenv = require("dotenv");
dotenv.config();


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const target = new OpenAIApi(configuration);

const logs: TrackRequestAudit[] = [];

export const openai = new Proxy(target, {
  get: (target, prop, receiver) => {
    const value = target[prop as keyof OpenAIApi];
    if (typeof value === "function") {
      const functionName = prop.toString();
      return (...args: any[]) => {

        //TODO: Need to know about return_pl_id
        // let return_pl_id = false;
        // const newArgs = args.map((arg) => {
        //   if (arg["return_pl_id"] !== undefined) {
        //     return_pl_id = arg["return_pl_id"];
        //     delete arg["return_pl_id"];
        //   }
        //   return arg;
        // });

        const requestStartTime = new Date();
        const result = (value as any).apply(target, args);

        if (result instanceof Promise) {
          result.then((response) => {
            const requestEndTime = new Date();

            //TODO: Figure out how to get the prompt_id, prompt_input_variables, prompt_version, and api_key
            const entry: TrackRequestAudit = {
              timestamp: new Date(),
              function_name: functionName,
              kwargs: {},
              request_response: response.data,
              request_start_time: requestStartTime,
              request_end_time: requestEndTime,
              tags: [],
              prompt_id: "",
              prompt_input_variables: {},
              prompt_version: 0,
              api_key: "",
            };
            logs.push(entry);
            console.log(JSON.stringify(entry, null, 4));
          });
        } else {
          const requestEndTime = new Date();
          
          //TODO: Figure out how to get the prompt_id, prompt_input_variables, prompt_version, and api_key
          const entry: TrackRequestAudit = {
            timestamp: new Date(),
            function_name: functionName,
            kwargs: {},
            request_response: result,
            request_start_time: requestStartTime,
            request_end_time: requestEndTime,
            tags: [],
            prompt_id: "",
            prompt_input_variables: {},
            prompt_version: 0,
            api_key: "",
          };
          logs.push(entry);
          console.log(JSON.stringify(entry, null, 4));
        }
        return result;
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
