import { rest } from "msw";

export const handlers = [
  rest.post("https://api.promptlayer.com/track-request", (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        request_id: 1234567890,
      })
    );
  }),
];
