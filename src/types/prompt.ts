export interface Retrieve {
  prompt_name: string;
  version?: number;
  label?: string;
}

export interface Response {
  prompt_template: any;
  metadata: any;
}

export interface Publish {
  prompt_name: string;
  prompt_template: any;
  commit_message?: string;
  tags?: string[];
  metadata?: any;
}
