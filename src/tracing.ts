import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'promptlayer-service',
    }),
    traceExporter: new OTLPTraceExporter(),
    spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
    instrumentations: [
        getNodeAutoInstrumentations({
            // Disable fs instrumentation
            '@opentelemetry/instrumentation-fs': {
                enabled: false,
            },
            // You can disable other instrumentations that might be causing issues
            // '@opentelemetry/instrumentation-http': {
            //   enabled: false,
            // },
        }),
    ],
});

sdk.start();

// Gracefully shut down the SDK on process exit
process.on('SIGTERM', () => {
    sdk.shutdown()
        .then(() => console.log('Tracing terminated'))
        .catch((error) => console.log('Error terminating tracing', error))
        .finally(() => process.exit(0));
});