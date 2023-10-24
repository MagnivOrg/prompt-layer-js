export interface Retrieve {
  prompt_name: string;
  version?: number;
  label?: string;
}

export interface Response {
  prompt_template: any;
  metadata: any;
}
