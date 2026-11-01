import { describe, expect, it } from "vitest";
import { CATALOG_ID, SURFACE_IDS, isSurfaceId } from "./protocol";
import { SURFACES, componentsOf } from "./surfaces";

describe("A2UI surfaces", () => {
  it("gives every award method its own v0.9 document", () => {
    expect(SURFACE_IDS).toHaveLength(8);
    for (const id of SURFACE_IDS) {
      const messages = SURFACES[id];
      const created = messages.find((message) => "createSurface" in message);
      const update = messages.find((message) => "updateComponents" in message);
      expect(created && "createSurface" in created && created.createSurface).toMatchObject({
        surfaceId: id,
        catalogId: CATALOG_ID,
      });
      expect(update && "updateComponents" in update).toBe(true);
      const components = componentsOf(id);
      const ids = components.map((component) => component.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("root");
      expect(components.some((component) => component.component === "Input")).toBe(true);
      for (const component of components) {
        for (const childId of component.children ?? []) {
          expect(ids).toContain(childId);
        }
      }
    }
  });

  it("rejects unknown surface names", () => {
    expect(isSurfaceId("glass")).toBe(true);
    expect(isSurfaceId("spotify")).toBe(false);
  });
});
