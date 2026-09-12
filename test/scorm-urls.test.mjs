import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalScormIdentity,
  matchingScormTargetIndex,
  parseScormUrl,
  scormUrlCandidates,
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

test("preserves the entered route and exposes known fallbacks last", () => {
  assert.deepEqual(scormUrlCandidates(bareUrl), [
    bareUrl,
    outlineUrl,
    "https://u-tad.blackboard.com/ultra/courses/_14330_1/grades/scorm/overview/_641800_1?courseId=_14330_1",
  ]);
  assert.equal(scormUrlCandidates(nestedUrl)[0], nestedUrl);
  assert.equal(
    parseScormUrl(nestedUrl)?.route,
    "content/learning-modules",
  );
});

test("matches a canonical Blackboard href by course/item identity, not exact URL text", () => {
  const target = parseScormUrl(bareUrl);
  const hrefs = [
    "/ultra/courses/_999_1/outline/scorm/overview/_641800_1?courseId=_999_1",
    "/ultra/courses/_14330_1/outline/scorm/overview/_641800_1/scorm/launchFrame?courseId=_14330_1",
  ];

  assert.equal(matchingScormTargetIndex(hrefs, "https://u-tad.blackboard.com/ultra/stream", target), 1);
});

test("uses the same cache identity for route and query variants", () => {
  assert.equal(canonicalScormIdentity(bareUrl), canonicalScormIdentity(outlineUrl));
});
