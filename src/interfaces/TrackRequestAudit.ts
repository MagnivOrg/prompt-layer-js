

import { AuditLogEntry } from "./AuditLogEntry";

export interface TrackRequestAudit extends AuditLogEntry {
    function_name: string
    kwargs: string;
    request_response: Record<string, any>
    request_start_time: Date
    request_end_time: Date
    tags: string[]
    prompt_id: string
    prompt_input_variables: string;
    prompt_version: number
    api_key: string
}