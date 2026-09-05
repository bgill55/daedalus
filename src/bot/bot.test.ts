import { describe, it, expect } from "vitest";
import { slashCommands } from "./commands.js";
import { getBotSystemPrompt } from "./prompt.js";
import { sanitizeBotReply } from "./handlers.js";
import {
  DEV_EXCUSES,
  COFFEE_RESPONSES,
  EXISTENTIAL_THOUGHTS,
  BLAME_RESPONSES,
  STANDUP_RESPONSES,
  PREDICT_RESPONSES,
  TECHSURPORT_RESPONSES,
} from "./responses.js";

describe("Daedalus Discord Bot", () => {
  describe("Slash Commands Definitions", () => {
    it("defines valid slash commands with unique names", () => {
      expect(slashCommands.length).toBeGreaterThan(15);
      const names = slashCommands.map((c) => c.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("includes core and modern commands", () => {
      const names = slashCommands.map((c) => c.name);
      expect(names).toContain("ask");
      expect(names).toContain("pantheon");
      expect(names).toContain("version");
      expect(names).toContain("webui");
      expect(names).toContain("marathon");
      expect(names).toContain("status");
      expect(names).toContain("docs");
      expect(names).toContain("roast");
    });

    it("serializes to valid JSON application commands", () => {
      for (const cmd of slashCommands) {
        const json = cmd.toJSON();
        expect(json.name).toBeDefined();
        expect(json.description).toBeDefined();
      }
    });
  });

  describe("System Prompt Generation", () => {
    it("generates prompt containing version and autonomous pantheon roles", () => {
      const prompt = getBotSystemPrompt();
      expect(prompt).toContain("You are Daedalus");
      expect(prompt).toContain("The Autonomous Pantheon (7 Specialized Roles)");
      expect(prompt).toContain("Marathon Engine");
      expect(prompt).toContain("WebUI & PWA Companion");
      expect(prompt).toContain("daedalus-cli");
    });

    it("includes creator recognition directive for creator usernames", () => {
      const promptBgill = getBotSystemPrompt("bgill55");
      expect(promptBgill).toContain("CREATOR RECOGNITION DIRECTIVE");
      expect(promptBgill).toContain("Brian");

      const promptBrica = getBotSystemPrompt("brica_dev");
      expect(promptBrica).toContain("CREATOR RECOGNITION DIRECTIVE");

      const promptGuest = getBotSystemPrompt("random_user");
      expect(promptGuest).not.toContain("CREATOR RECOGNITION DIRECTIVE");
    });
  });

  describe("Canned Responses Collections", () => {
    it("contains rich collections of developer banter and excuses", () => {
      expect(DEV_EXCUSES.length).toBeGreaterThan(5);
      expect(COFFEE_RESPONSES.length).toBeGreaterThan(5);
      expect(EXISTENTIAL_THOUGHTS.length).toBeGreaterThan(5);
      expect(BLAME_RESPONSES.length).toBeGreaterThan(5);
      expect(STANDUP_RESPONSES.length).toBeGreaterThan(5);
      expect(PREDICT_RESPONSES.length).toBeGreaterThan(5);
      expect(TECHSURPORT_RESPONSES.length).toBeGreaterThan(5);
    });
  });

  describe("Bot Output Sanitization", () => {
    it("strips think tags from output", () => {
      const input = "<think>internal reasoning</think>Here is the real answer.";
      expect(sanitizeBotReply(input)).toBe("Here is the real answer.");
    });

    it("collapses runaway repetitive text loops", () => {
      const input = "- Daedon-cli, Daedon-cli\n- Daedon-cli, Daedon-cli\n- Daedon-cli, Daedon-cli\n- Daedon-cli, Daedon-cli\n- Daedon-cli, Daedon-cli";
      const cleaned = sanitizeBotReply(input);
      const occurrences = cleaned.split('\n').filter(l => l.includes("Daedon-cli")).length;
      expect(occurrences).toBeLessThanOrEqual(2);
    });

    it("returns default fallback for empty text", () => {
      expect(sanitizeBotReply("")).toBe("Something went wrong in the machine.");
      expect(sanitizeBotReply("<think>only thinking</think>")).toBe("Something went wrong in the machine.");
    });
  });
});
