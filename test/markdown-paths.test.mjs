import test from "node:test";
import assert from "node:assert/strict";

import { portableManifestPath } from "../scripts/backend/scorm/markdown-exporter.mjs";

test("keeps in-repository artifact paths portable and external outputs absolute", () => {
  assert.equal(
    portableManifestPath("/workspace/exports/unit.md", "/workspace"),
    "exports/unit.md",
  );
  assert.equal(
    portableManifestPath("/tmp/unit.md", "/workspace"),
    "/tmp/unit.md",
  );
});
