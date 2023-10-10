import { getApiKey, promptLayerApiRequest } from "@/utils";

const promptLayerBase = (
  llm: object,
  function_name = "",
  provider = "openai"
) => {
  const handler: ProxyHandler<any> = {
    construct: (target, args) => {
      const newTarget = Reflect.construct(target, args);
      Object.defineProperties(newTarget, {
        function_name: {
          value: function_name,
          writable: true,
        },
        provider: {
          value: provider,
        },
      });
      return new Proxy(newTarget, handler);
    },
    get: (target, prop, receiver) => {
      const value = target[prop as keyof typeof target];
      if (prop === "post") return value;
      const function_name = Reflect.get(target, "function_name");
      Object.defineProperties(value, {
        function_name: {
          value: `${function_name}.${prop.toString()}`,
          writable: true,
        },
        provider: {
          value: Reflect.get(target, "provider"),
        },
      });
      return new Proxy(value, handler);
    },
    apply: (target, thisArg, argArray) => {
      const request_start_time = new Date().toISOString();
      const function_name = Reflect.get(target, "function_name");
      const provider_type = Reflect.get(target, "provider");
      const response = Reflect.apply(target, thisArg, argArray);
      if (response instanceof Promise) {
        response.then((request_response) => {
          const request_end_time = new Date().toISOString();
          promptLayerApiRequest({
            api_key: getApiKey(),
            provider_type,
            function_name,
            request_start_time,
            request_end_time,
            request_response,
            kwargs: argArray[0],
          });
          return request_response;
        });
      }
      return response;
    },
  };
  return new Proxy(llm, handler);
};

const dynamicExports = new Proxy<{ OpenAI: any; api_key: string | undefined }>(
  {
    OpenAI: {},
    api_key: process.env.PROMPTLAYER_API_KEY,
  },
  {
    get: (target, prop, receiver) => {
      if (prop === "OpenAI") {
        const moduleName = "openai";
        const module = require(moduleName).default;
        return promptLayerBase(module, moduleName, moduleName);
      }
      return Reflect.get(target, prop, receiver);
    },
  }
);

export default dynamicExports;
