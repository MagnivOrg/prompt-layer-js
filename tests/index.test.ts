import { describe, expect, it } from "vitest";

describe("test", () => it("should pass", () => expect(true).toBe(true)));

describe("promptlayer", () =>
  it("should not depend on openai", async () => {
    expect(() => require("promptlayer").default.OpenAI).toThrowError();
  }));
