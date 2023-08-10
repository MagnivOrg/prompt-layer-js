import { Configuration, OpenAIApi } from "openai";
const dotenv = require("dotenv");
dotenv.config()
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const target = new OpenAIApi(configuration);




interface AuditLogEntry {
  timestamp: Date;
  method: string;
  arguments: any[];
  response?: any;
  requestStart?: Date;
  requestEnd?: Date;
}


const logs: AuditLogEntry[] = [];



export const openai = new Proxy(target, {
  get: (target, prop, receiver) => {
    const value = target[prop as keyof OpenAIApi];
    if (typeof value === "function") {
      const methodName = prop.toString();
      return (...args: any[]) => {
        let return_pl_id = false;
        const newArgs = args.map((arg) => {
          if (arg["return_pl_id"] !== undefined) {
            return_pl_id = arg["return_pl_id"];
            delete arg["return_pl_id"];
          }
          return arg;
        });

        const requestStart = new Date(); // Capture request start time
        const result = (value as any).apply(target, args);

        if (result instanceof Promise) {
          result.then(res => {
            const requestEnd = new Date(); // Capture request end time
            const entry: AuditLogEntry = {
              timestamp: new Date(),
              method: methodName,
              arguments: newArgs,
              response: res,
              requestStart,
              requestEnd,
            };
            logs.push(entry);
            console.log(entry);
          })
        } else {
          const requestEnd = new Date(); // Capture request end time
          const entry: AuditLogEntry = {
            timestamp: new Date(),
            method: methodName,
            arguments: newArgs,
            response: result,
            requestStart,
            requestEnd,
          };
          logs.push(entry);
          console.log(entry);
        }
        return result;
      };
    }
    const result = Reflect.get(target, prop, receiver);

    console.log({
      returnValue: JSON.stringify(result),
    })
    return result;
  },
  
});
