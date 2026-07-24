import { describe, expect, it } from "vitest";
import {
  AI_PRESETS,
  isAiProvider,
  parseAssistantRoles,
  resolveEndpoint,
} from "@/lib/ai/presets";

const STAFF = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"];

describe("resolveEndpoint", () => {
  it("falls back to the provider preset", () => {
    const r = resolveEndpoint("deepseek", null, null);
    expect(r).toEqual({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      dialect: "openai",
    });
  });

  it("lets explicit settings win over the preset", () => {
    const r = resolveEndpoint("kimi", "https://proxy.example.com/v1/", "my-model");
    expect(r.baseUrl).toBe("https://proxy.example.com/v1"); // trailing slash trimmed
    expect(r.model).toBe("my-model");
    expect(r.dialect).toBe("openai");
  });

  it("anthropic speaks its own dialect", () => {
    expect(resolveEndpoint("anthropic", null, null).dialect).toBe("anthropic");
    expect(AI_PRESETS.anthropic.baseUrl).toBe("https://api.anthropic.com");
  });

  it("custom has no preset to fall back to", () => {
    const r = resolveEndpoint("custom", "", "");
    expect(r.baseUrl).toBe("");
    expect(r.model).toBe("");
  });
});

describe("isAiProvider", () => {
  it("accepts known providers and rejects junk", () => {
    expect(isAiProvider("deepseek")).toBe(true);
    expect(isAiProvider("gpt")).toBe(false);
    expect(isAiProvider("")).toBe(false);
  });
});

describe("parseAssistantRoles", () => {
  it("defaults to admin only", () => {
    expect(parseAssistantRoles(null, STAFF)).toEqual(["ADMIN"]);
    expect(parseAssistantRoles("", STAFF)).toEqual(["ADMIN"]);
  });

  it("parses a stored list and filters unknown roles", () => {
    expect(parseAssistantRoles('["ADMIN","RECEPTIONIST","HACKER"]', STAFF)).toEqual([
      "ADMIN",
      "RECEPTIONIST",
    ]);
  });

  it("never locks the admin out", () => {
    expect(parseAssistantRoles('["ACCOUNTANT"]', STAFF)).toEqual(["ADMIN", "ACCOUNTANT"]);
  });

  it("survives invalid JSON and non-arrays", () => {
    expect(parseAssistantRoles("not json", STAFF)).toEqual(["ADMIN"]);
    expect(parseAssistantRoles('{"a":1}', STAFF)).toEqual(["ADMIN"]);
  });
});
