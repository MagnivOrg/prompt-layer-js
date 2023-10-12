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
import promptlayer from "promptlayer";

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
});
```

After making your first few requests, you should be able to see them in the PromptLayer dashboard!

## Using the REST API

This JavaScript library is a wrapper over PromptLayer's REST API. If you use another language, just interact directly with the API.

Here is an example request below:

```js
fetch("https://api.promptlayer.com/track-request", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    function_name: "openai.completions.create",
    args: [],
    kwargs: {
      model: "text-ada-001",
      prompt: "My name is",
    },
    tags: ["hello", "world"],
    request_response: {
      id: "cmpl-6TEeJCRVlqQSQqhD8CYKd1HdCcFxM",
      object: "text_completion",
      created: 1672425843,
      model: "text-ada-001",
      choices: [
        {
          text: ' advocacy"\n\nMy name is advocacy.',
          index: 0,
          logprobs: null,
          finish_reason: "stop",
        },
      ],
    },
    request_start_time: 1673987077.463504,
    request_end_time: 1673987077.463504,
    api_key: "pl_<YOUR API KEY>",
  }),
});
```

## Contributing

We welcome contributions to our open source project, including new features, infrastructure improvements, and better documentation. For more information or any questions, contact us at [hello@promptlayer.com](mailto:hello@promptlayer.com).
