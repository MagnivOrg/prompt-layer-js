import '@/tracing';
import BaseOpenAI from "openai";
import { PromptLayer } from "@/index";
import { trace, SpanStatusCode } from '@opentelemetry/api';

const promptlayer = new PromptLayer({
    apiKey: process.env.PROMPTLAYER_API_KEY
});

const OpenAI: typeof BaseOpenAI = promptlayer.OpenAI;
const openai = new OpenAI();

const tracer = trace.getTracer('sample-tracer');

const main = async () => {
    return tracer.startActiveSpan('main', async (span) => {
        try {
            await openai.chat.completions.create({
                messages: [{ role: "user", content: "Say this is a test" }],
                model: "gpt-3.5-turbo",
                // @ts-ignore
                pl_tags: ["test"],
            });
            span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
            console.error("An error occurred:", error);
            span.recordException(error instanceof Error ? error : new Error('An error occurred'));
            span.setStatus({ code: SpanStatusCode.ERROR });
        } finally {
            span.end();
        }
    });
};

main().then(() => console.log('Done')).catch(console.error);
