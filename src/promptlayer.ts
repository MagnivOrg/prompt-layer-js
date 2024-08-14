import {getTracer} from "@/tracing";
import { promptlayerApiHandler } from "@/utils";

const tracer = getTracer();

export const promptLayerBase = (
  apiKey: string,
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
      const value = target[prop];
      const function_name = `${Reflect.get(
        target,
        "function_name"
      )}.${prop.toString()}`;

      if (typeof value === "object") {
        Object.defineProperties(value, {
          function_name: {
            value: function_name,
            writable: true,
          },
          provider: {
            value: provider,
          },
        });
        return new Proxy(value, handler);
      }

      if (typeof value === "function") {
        return (...args: any[]) => {
          const request_start_time = new Date().toISOString();
          const provider_type = Reflect.get(target, "provider");
          const return_pl_id = args[0]?.return_pl_id;
          const pl_tags = args[0]?.pl_tags;
          delete args[0]?.return_pl_id;
          delete args[0]?.pl_tags;

          // Create a span for the API call
          return tracer.startActiveSpan(`${provider_type}.${function_name}`, async (span: any) => {
            try {
              // Set span attributes
              span.setAttribute('provider_type', provider_type);
              span.setAttribute('function_name', function_name);
              if (pl_tags) {
                span.setAttribute('pl_tags', JSON.stringify(pl_tags));
              }

              // Call the original function
              const response = Reflect.apply(value, target, args);

              if (response instanceof Promise) {
                return new Promise((resolve, reject) => {
                  response
                      .then(async (request_response) => {
                        const response = await promptlayerApiHandler(apiKey, {
                          api_key: apiKey,
                          provider_type,
                          function_name,
                          request_start_time,
                          request_end_time: new Date().toISOString(),
                          request_response,
                          kwargs: args[0],
                          return_pl_id,
                          tags: pl_tags,
                        });

                        // Add response information to the span
                        span.setAttribute('response_status', 'success');
                        span.end();
                        resolve(response);
                      })
                      .catch((error) => {
                        // Record error in the span
                        span.recordException(error);
                        span.setAttribute('response_status', 'error');
                        span.end();
                        reject(error);
                      });
                });
              }

              // For non-promise responses
              span.setAttribute('response_status', 'success');
              span.end();
              return response;
            } catch (error) {
              // Record error in the span
              span.recordException(error);
              span.setAttribute('response_status', 'error');
              span.end();
              throw error;
            }
          });
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(llm, handler);
};
