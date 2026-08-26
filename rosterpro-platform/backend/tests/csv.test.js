const { toCsv, escapeCsvValue } = require("../src/utils/csv");

describe("escapeCsvValue", () => {
  it("leaves plain values unquoted", () => {
    expect(escapeCsvValue("simple")).toBe("simple");
  });
  it("quotes values containing a comma", () => {
    expect(escapeCsvValue("has,comma")).toBe('"has,comma"');
  });
  it("escapes embedded quotes by doubling them", () => {
    expect(escapeCsvValue('has"quote')).toBe('"has""quote"');
  });
  it("converts null/undefined to an empty string", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });
  it("stringifies numbers", () => {
    expect(escapeCsvValue(42)).toBe("42");
  });
});

describe("toCsv", () => {
  it("prefixes a UTF-8 BOM so Excel opens it correctly", () => {
    expect(toCsv([["a"]]).startsWith("\uFEFF")).toBe(true);
  });
  it("properly quotes a comma-containing field within a full row", () => {
    const csv = toCsv([["Name", "Age"], ["Rakesh, Kumar", "45"]]);
    expect(csv).toContain('"Rakesh, Kumar"');
  });
});
