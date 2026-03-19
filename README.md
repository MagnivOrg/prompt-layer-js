<div align="center">

# 🍰 PromptLayer

**The first platform built for <span style="background-color: rgb(219, 234, 254);">prompt engineers</span>**

<a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white"></a>
<a href="https://docs.promptlayer.com"><img alt="Docs" src="https://custom-icon-badges.herokuapp.com/badge/docs-PL-green.svg?logo=cake&style=for-the-badge"></a>
<a href="https://www.loom.com/share/196c42e43acd4a369d75e9a7374a0850"><img alt="Demo with Loom" src="https://img.shields.io/badge/Demo-loom-552586.svg?logo=loom&style=for-the-badge&labelColor=gray"></a>

---

<div align="left">

[PromptLayer](https://promptlayer.com/) is the first platform that allows you to track, manage, and share your GPT prompt engineering. PromptLayer acts a middleware between your code and OpenAI’s JavaScript library.

PromptLayer records all your OpenAI API requests, allowing you to search and explore request history in the PromptLayer dashboard.

This repo contains the JavaScript wrapper library for PromptLayer.

## Quickstart ⚡

### Install PromptLayer

```bash
npm install promptlayer
```

### Installing PromptLayer Locally

Use `npm install .` to install locally.

### Using PromptLayer

To get started, create an account by clicking “_Log in_” on [PromptLayer](https://promptlayer.com/). Once logged in, click the button to create an API key and save this in a secure location ([Guide to Using Env Vars](https://nodejs.dev/en/learn/how-to-read-environment-variables-from-nodejs/)).

```bash
export OPENAI_API_KEY=sk_xxxxxx
export PROMPTLAYER_API_KEY=pl_xxxxxx
```

Once you have that all set up, install PromptLayer using `npm`.

In the JavaScript file where you use OpenAI APIs, add the following. This allows us to keep track of your requests without needing any other code changes.

```js
import BaseOpenAI from "openai";
import { PromptLayer } from "promptlayer";

const promptlayer = new PromptLayer({
  apiKey: process.env.PROMPTLAYER_API_KEY,
});
// Typescript
const OpenAI: typeof BaseOpenAI = promptlayer.OpenAI;
const openai = new OpenAI();
```

**You can then use `openai` as you would if you had imported it directly.**

<aside>
💡 Your OpenAI API Key is **never** sent to our servers. All OpenAI requests are made locally from your machine, PromptLayer just logs the request.
</aside>

### Adding PromptLayer tags: `pl_tags`

PromptLayer allows you to add tags through the `pl_tags` argument. This allows you to track and group requests in the dashboard.

_Tags are not required but we recommend them!_

```js
openai.chat.completions.create({
  messages: [{ role: "user", content: "Say this is a test" }],
  model: "gpt-3.5-turbo",
  // @ts-ignore
  pl_tags: ["test"],
});
```

### Returning request id: `return_pl_id`

PromptLayer allows you to return the request id through the `return_pl_id` argument. When you set this to `true`, a tuple is returned with the request id as the second element.

```js
openai.chat.completions.create({
  messages: [{ role: "user", content: "Say this is a test" }],
  model: "gpt-3.5-turbo",
  // @ts-ignore
  return_pl_id: true,
});
```

<aside>
  Notice the `ts-ignore` comment. This is because the `pl_tags` and `return_pl_id` arguments are not part of the OpenAI API. We are working on a way to make this more seamless.
</aside>

After making your first few requests, you should be able to see them in the PromptLayer dashboard!

## Optional Extensions

OpenAI Agents telemetry support is available as an optional extension of the
base library.

```bash
npm install promptlayer @openai/agents
```

Claude Agents plugin support is available as an optional extension of the base
library on macOS and Linux.

```bash
npm install promptlayer @anthropic-ai/claude-agent-sdk
```

```ts
import { ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { getClaudeConfig } from "promptlayer/claude-agents";

const plClaudeConfig = getClaudeConfig();

const options = new ClaudeAgentOptions({
  model: "claude-sonnet-4-5",
  plugins: [plClaudeConfig.plugin],
  env: {
    ...plClaudeConfig.env,
  },
});
```

## Contributing

We welcome contributions to our open source project, including new features, infrastructure improvements, and better documentation. For more information or any questions, contact us at [hello@promptlayer.com](mailto:hello@promptlayer.com).

## Requirements

- Node.js 18.x or higher
