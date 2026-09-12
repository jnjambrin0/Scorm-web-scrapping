import test from "node:test";
import assert from "node:assert/strict";

import {
  matchingScormTargetIndexes,
  parseScormUrl,
  scormSourceIdentity,
} from "../scripts/backend/scorm/urls.mjs";

const bareUrl =
  "https://u-tad.blackboard.com/ultra/courses/_14330_1/scorm/overview/_641800_1";
const outlineUrl =
  "https://u-tad.blackboard.com/ultra/courses/_14330_1/outline/scorm/overview/_641800_1?courseId=_14330_1";
const gradesUrl =
  "https://u-tad.blackboard.com/ultra/courses/_14330_1/grades/scorm/overview/_641800_1";
const nestedUrl =
  "https://u-tad.blackboard.com/ultra/courses/_14330_1/content/learning-modules/scorm/overview/_641800_1?view=student";
const reportedBareUrl =
  "https://u-tad.blackboard.com/ultra/courses/_14390_1/scorm/overview/_689299_1";

test("recognizes Blackboard SCORM overview URL variants as direct targets", () => {
  assert.ok(parseScormUrl(bareUrl));
  assert.ok(parseScormUrl(outlineUrl));
  assert.ok(parseScormUrl(gradesUrl));
  assert.ok(parseScormUrl(nestedUrl));
  assert.deepEqual(parseScormUrl(reportedBareUrl)?.identity, reportedBareUrl);
  assert.equal(parseScormUrl("https://u-tad.blackboard.com/ultra/stream"), null);
  assert.equal(
    parseScormUrl("https://u-tad.blackboard.com/ultra/courses/_14330_1/outline"),
    null,
  );
});

test("extracts stable course and item identity", () => {
  const target = parseScormUrl(bareUrl);
  assert.ok(target);
  assert.equal(target.courseId, "_14330_1");
  assert.equal(target.itemId, "_641800_1");
  assert.equal(
    target.identity,
    "https://u-tad.blackboard.com/ultra/courses/_14330_1/scorm/overview/_641800_1",
  );
});

test("preserves the entered direct route without creating fallback URLs", () => {
  assert.equal(parseScormUrl(nestedUrl)?.inputUrl, nestedUrl);
  assert.equal(
    parseScormUrl(nestedUrl)?.route,
    "content/learning-modules",
  );
  assert.equal(
    parseScormUrl(`${bareUrl}#lesson`)?.inputUrl,
    bareUrl,
  );
  assert.notEqual(scormSourceIdentity(bareUrl), scormSourceIdentity(outlineUrl));
});

test("selects only same-origin DOM links with the exact course and item identity", () => {
  const target = parseScormUrl(reportedBareUrl);
  assert.deepEqual(
    matchingScormTargetIndexes(
      [
        "/ultra/courses/_14390_1/outline/scorm/overview/_689299_1?courseId=_14390_1",
        "/ultra/courses/_14390_1/grades/scorm/overview/_other_1",
        "https://other.example/ultra/courses/_14390_1/outline/scorm/overview/_689299_1",
      ],
      "https://u-tad.blackboard.com/ultra/stream",
      target,
    ),
    [0],
  );
});
