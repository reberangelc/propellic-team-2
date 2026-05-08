import { describe, it, expect } from "vitest";
import { extractCTAs } from "../src/server/extractors/extractCTAs";
import { extractTrustSignals } from "../src/server/extractors/extractTrustSignals";
import { extractFormFields } from "../src/server/extractors/extractFormFields";
import { extractHeadlines } from "../src/server/extractors/extractHeadlines";
import { validateUrl } from "../src/server/utils/validateUrl";

const MINIMAL_HTML = "<html><body></body></html>";

describe("validateUrl", () => {
  it("allows valid https URLs", () => {
    expect(validateUrl("https://booking.com")).toEqual({ valid: true });
  });
  it("allows valid http URLs", () => {
    expect(validateUrl("http://example.com")).toEqual({ valid: true });
  });
  it("blocks localhost", () => {
    expect(validateUrl("http://localhost:3000")).toEqual({ valid: false, reason: "Blocked hostname" });
  });
  it("blocks 127.0.0.1", () => {
    expect(validateUrl("http://127.0.0.1")).toEqual({ valid: false, reason: "Blocked hostname" });
  });
  it("blocks private 10.x range", () => {
    expect(validateUrl("http://10.0.0.1")).toEqual({ valid: false, reason: "Private IP range is not allowed" });
  });
  it("blocks private 192.168.x range", () => {
    expect(validateUrl("http://192.168.1.1")).toEqual({ valid: false, reason: "Private IP range is not allowed" });
  });
  it("blocks ftp protocol", () => {
    expect(validateUrl("ftp://example.com").valid).toBe(false);
  });
  it("rejects unparseable input", () => {
    expect(validateUrl("not a url")).toEqual({ valid: false, reason: "URL could not be parsed" });
  });
});

describe("extractCTAs", () => {
  it("returns empty array for minimal HTML", () => {
    expect(extractCTAs(MINIMAL_HTML)).toEqual([]);
  });
  it("finds a book button", () => {
    const result = extractCTAs(`<html><body><button>Book Now</button></body></html>`);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toBe("Book Now");
    expect(result[0].tagName).toBe("button");
  });
  it("deduplicates by text", () => {
    const result = extractCTAs(`<html><body><button>Book Now</button><button>Book Now</button></body></html>`);
    expect(result.filter((c) => c.text === "Book Now").length).toBe(1);
  });
  it("marks hero CTAs as above fold", () => {
    const result = extractCTAs(`<html><body><div class="hero"><button>Reserve Your Spot</button></div></body></html>`);
    expect(result[0].isAboveFold).toBe(true);
  });
  it("does not throw on malformed HTML", () => {
    expect(() => extractCTAs("<html><body><<<<</body></html>")).not.toThrow();
  });
});

describe("extractTrustSignals", () => {
  it("returns array for minimal HTML", () => {
    expect(Array.isArray(extractTrustSignals(MINIMAL_HTML))).toBe(true);
  });
  it("detects review count in text", () => {
    const result = extractTrustSignals(`<html><body><p>Based on 1,234 reviews</p></body></html>`);
    expect(result.find((s) => s.type === "review_count")).toBeDefined();
  });
  it("does not throw on malformed HTML", () => {
    expect(() => extractTrustSignals("<<<<")).not.toThrow();
  });
});

describe("extractFormFields", () => {
  it("returns empty fields for page with no form", () => {
    const result = extractFormFields(MINIMAL_HTML);
    expect(result.fields.length).toBe(0);
    expect(result.formCount).toBe(0);
  });
  it("extracts form fields correctly", () => {
    const result = extractFormFields(`<html><body><form>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required />
      <input type="submit" value="Submit" />
    </form></body></html>`);
    expect(result.fields.length).toBe(1);
    expect(result.fields[0].type).toBe("email");
    expect(result.fields[0].required).toBe(true);
    expect(result.fields[0].hasLabel).toBe(true);
    expect(result.fields[0].autofillFriendly).toBe(true);
  });
  it("excludes hidden and submit fields", () => {
    const result = extractFormFields(`<html><body><form>
      <input type="hidden" name="csrf" />
      <input type="submit" value="Go" />
      <input type="text" name="name" />
    </form></body></html>`);
    expect(result.fields.length).toBe(1);
  });
  it("does not throw on malformed HTML", () => {
    expect(() => extractFormFields("<form><input type='text'")).not.toThrow();
  });
});

describe("extractHeadlines", () => {
  it("returns empty strings for minimal HTML", () => {
    const result = extractHeadlines(MINIMAL_HTML);
    expect(result.h1).toBe("");
    expect(result.h2s).toEqual([]);
  });
  it("extracts h1, h2s, and title", () => {
    const result = extractHeadlines(`<html><head><title>Page Title</title></head><body>
      <h1>Book Your Dream Trip</h1>
      <h2>Popular Destinations</h2>
      <h2>Why Choose Us</h2>
    </body></html>`);
    expect(result.h1).toBe("Book Your Dream Trip");
    expect(result.h2s).toContain("Popular Destinations");
    expect(result.metaTitle).toBe("Page Title");
  });
  it("extracts meta description", () => {
    const result = extractHeadlines(`<html><head>
      <meta name="description" content="Affordable travel packages." />
    </head><body></body></html>`);
    expect(result.metaDescription).toBe("Affordable travel packages.");
  });
  it("does not throw on malformed HTML", () => {
    expect(() => extractHeadlines("<h1>")).not.toThrow();
  });
});
