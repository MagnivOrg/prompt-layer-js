import { Configuration, OpenAIApi } from "openai";


interface AuditLogEntry {
    timestamp: Date;
    method: string;
    arguments: any[];
    response?: any;
    requestStart?: Date;
    requestEnd?: Date;
  }
  

class AuditLog {
    logs: AuditLogEntry[] = [];

    log(entry: AuditLogEntry) {
        console.log(entry)
        this.logs.push(entry);
    }

    getAllLogs() {
        return this.logs;
    }
}

const auditLog = new AuditLog();

// create a proxy to the OpenAIApi class    
const OpenAIApiProxy = new Proxy(OpenAIApi, {
    construct(target, args) {
        // create audit log entry
        const entry: AuditLogEntry = {
            timestamp: new Date(),
            method: "constructor",
            arguments: args
        }
        auditLog.log(entry);
        return new target(...args);
    },
    // get(target, prop, receiver) {
    //     // create audit log entry
    //     const entry: AuditLogEntry = {
    //         timestamp: new Date(),
    //         method: prop.toString(),
    //         arguments: []
    //     }
    //     auditLog.log(entry);
    //     return Reflect.get(target, prop, receiver);
    // },
    get(target, prop, receiver) {
        const method = Reflect.get(target, prop, receiver);

        if (typeof method === "function") {
            return function(this: any, ...args: any[]) {
                const entry: AuditLogEntry = {
                    timestamp: new Date(),
                    method: prop.toString(),
                    arguments: args
                };
                auditLog.log(entry);
                return method.apply(this, args);
            };
        }

        return method;
    },
    apply(target, thisArg, args) {
        // create audit log entry
        const entry: AuditLogEntry = {
            timestamp: new Date(),
            method: "apply",
            arguments: args
        }
        auditLog.log(entry);
        return Reflect.apply(target, thisArg, args);
    },
    set(target, prop, value, receiver) {
        // create audit log entry
        const entry: AuditLogEntry = {
            timestamp: new Date(),
            method: "set",
            arguments: [prop, value]
        }
        auditLog.log(entry);
        return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
        // create audit log entry
        const entry: AuditLogEntry = {
            timestamp: new Date(),
            method: "deleteProperty",
            arguments: [prop]
        }
        auditLog.log(entry);
        return Reflect.deleteProperty(target, prop);
    }
});

export { Configuration, OpenAIApiProxy as OpenAIApi };