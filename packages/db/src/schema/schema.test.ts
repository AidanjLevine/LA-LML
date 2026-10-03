import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index.js";
import { parseEwkb } from "./columns.js";

describe("schema", () => {
  it("defines every table with id, created_at and updated_at", () => {
    const tables = [
      schema.neighborhoods,
      schema.venues,
      schema.artists,
      schema.series,
      schema.events,
      schema.eventArtists,
      schema.prices,
      schema.sources,
      schema.sourceRecords,
      schema.eventSources,
      schema.proposals,
    ];
    for (const table of tables) {
      const names = getTableConfig(table).columns.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["id", "created_at", "updated_at"]));
    }
  });

  it("enables row level security on every exported table", () => {
    const tables = Object.values(schema).filter((value) => is(value, PgTable));
    expect(tables.length).toBe(11);
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(config.enableRLS, `${config.name} must call .enableRLS()`).toBe(true);
    }
  });
});

// Hex EWKB as returned by PostGIS for SRID 4326 geometries.
const POINT_HEX = "0101000020E61000009B559FABAD905DC0E02D90A0F8094140";
const POLYGON_HEX =
  "0103000020E61000000100000004000000E17A14AE47915DC0295C8FC2F50841400000000000905DC0295C8FC2F5084140" +
  "0000000000905DC0EC51B81E850B4140E17A14AE47915DC0295C8FC2F5084140";

describe("parseEwkb", () => {
  it("parses a point", () => {
    expect(parseEwkb(POINT_HEX)).toEqual({ type: "Point", point: { x: -118.2606, y: 34.0779 } });
  });

  it("parses a polygon", () => {
    expect(parseEwkb(POLYGON_HEX)).toEqual({
      type: "Polygon",
      rings: [
        [
          [-118.27, 34.07],
          [-118.25, 34.07],
          [-118.25, 34.09],
          [-118.27, 34.07],
        ],
      ],
    });
  });
});

describe("geometry columns", () => {
  const venueLocation = getTableConfig(schema.venues).columns.find((c) => c.name === "location")!;
  const boundary = getTableConfig(schema.neighborhoods).columns.find((c) => c.name === "boundary")!;

  it("use SRID 4326 PostGIS types", () => {
    expect(venueLocation.getSQLType()).toBe("geometry(Point, 4326)");
    expect(boundary.getSQLType()).toBe("geometry(Polygon, 4326)");
  });

  it("write EWKT and read EWKB", () => {
    expect(venueLocation.mapToDriverValue({ x: -118.2606, y: 34.0779 })).toBe("SRID=4326;POINT(-118.2606 34.0779)");
    expect(venueLocation.mapFromDriverValue(POINT_HEX)).toEqual({ x: -118.2606, y: 34.0779 });
    expect(
      boundary.mapToDriverValue([
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ]),
    ).toBe("SRID=4326;POLYGON((0 0, 1 0, 0 1, 0 0))");
  });
});
