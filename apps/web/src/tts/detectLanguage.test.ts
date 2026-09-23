import { describe, expect, it } from "vitest";
import { detectLanguage, fallbackFor, pickVoice } from "./detectLanguage";

describe("detectLanguage", () => {
  it("detects Chinese", () => expect(detectLanguage("大家好")).toBe("zh-CN"));
  it("prefers Japanese when kana are present with kanji", () =>
    expect(detectLanguage("今日はいい天気")).toBe("ja-JP"));
  it("detects Korean", () => expect(detectLanguage("안녕하세요")).toBe("ko-KR"));
  it("detects Russian", () => expect(detectLanguage("привет")).toBe("ru-RU"));
  it("falls back for Latin text", () => expect(detectLanguage("hello", "zh-CN")).toBe("zh-CN"));
  it("uses English when nothing is given", () => expect(detectLanguage("hi")).toBe("en-US"));
});

describe("fallbackFor", () => {
  it("maps the Chinese UI to zh-CN", () => expect(fallbackFor("zh-CN")).toBe("zh-CN"));
  it("maps anything else to en-US", () => expect(fallbackFor("en")).toBe("en-US"));
});

describe("pickVoice", () => {
  const voices = [
    { name: "a", lang: "en-GB" },
    { name: "b", lang: "zh_CN" },
    { name: "c", lang: "en-US" },
  ];
  it("prefers an exact tag", () => expect(pickVoice(voices, "en-US")?.name).toBe("c"));
  it("accepts underscore tags", () => expect(pickVoice(voices, "zh-CN")?.name).toBe("b"));
  it("returns null with no match", () => expect(pickVoice(voices, "ja-JP")).toBeNull());
});
