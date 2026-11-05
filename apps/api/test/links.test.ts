import { describe, expect, it } from "vitest";
import { podcastLinks } from "../src/ingest/podcast.ts";

describe("podcast source links", () => {
  it("lists the episode page, the transcript used and the audio", () => {
    const links = podcastLinks("https://feeds.example.com/show.xml#episode=Ep%201", { link: "https://example.com/ep1", audioUrl: "https://cdn.example.com/ep1.mp3", transcripts: [{ url: "https://example.com/ep1.json", type: "application/json" }, { url: "https://example.com/ep1.vtt", type: "text/vtt" }] }, { url: "https://example.com/ep1.vtt", type: "text/vtt" });
    expect(links).toEqual([
      { kind: "original", label: "Episode page", url: "https://example.com/ep1" },
      { kind: "transcript", label: "Publisher's transcript", url: "https://example.com/ep1.vtt" },
      { kind: "audio", label: "Listen to the audio", url: "https://cdn.example.com/ep1.mp3", note: undefined },
    ]);
  });
  it("says when there was no published transcript", () => {
    const links = podcastLinks("https://cdn.example.com/ep2.mp3", { link: "https://cdn.example.com/ep2.mp3", audioUrl: "https://cdn.example.com/ep2.mp3", transcripts: [] }, null);
    expect(links).toEqual([{ kind: "audio", label: "Listen to the audio", url: "https://cdn.example.com/ep2.mp3", note: "No published transcript. This gist was made from the audio." }]);
  });
});
