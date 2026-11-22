import { describe, expect, it } from "vitest";
import { MigrationError, parseMigrationName } from "./name.ts";

describe("parseMigrationName", () => {
  it("accepts a valid name and returns its UTC datetime", () => {
    const parsed = parseMigrationName("20261121143512_add_widget_color.sql");
    expect(parsed.name).toBe("add_widget_color");
    expect(parsed.timestamp.toISOString()).toBe("2026-11-21T14:35:12.000Z");
  });

  it("accepts Feb 29 in a leap year and digits inside the name", () => {
    expect(parseMigrationName("20240229000000_add_v2_index.sql").name).toBe("add_v2_index");
  });

  it.each([
    ["bad month", "20261341000000_create_widgets.sql"],
    ["Feb 30", "20260230000000_create_widgets.sql"],
    ["Feb 29 in a non-leap year", "20260229000000_create_widgets.sql"],
    ["bad hour", "20261121240000_create_widgets.sql"],
    ["bad minute", "20261121146000_create_widgets.sql"],
    ["bad second", "20261121143060_create_widgets.sql"],
    ["short timestamp", "2026112114300_create_widgets.sql"],
    ["sequential number", "0001_create_widgets.sql"],
    ["short name", "20261121143000_ab.sql"],
    ["single letter", "20261121143000_a.sql"],
    ["leading digit", "20261121143000_1widgets.sql"],
    ["numeric name", "20261121143000_0001.sql"],
    ["trailing underscore", "20261121143000_widgets_.sql"],
    ["double underscore", "20261121143000_add__widgets.sql"],
    ["uppercase", "20261121143000_Add_Widgets.sql"],
    ["hyphen", "20261121143000_add-widgets.sql"],
    ["no name", "20261121143000.sql"],
    ["stray file", "notes.sql"],
  ])("rejects %s", (_label, file) => {
    expect(() => parseMigrationName(file)).toThrow(MigrationError);
    expect(() => parseMigrationName(file)).toThrow(file);
  });
});
