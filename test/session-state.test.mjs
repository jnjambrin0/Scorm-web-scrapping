import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySessionDestination,
  inspectProfileCookies,
} from "../scripts/backend/browser/session-state.mjs";

const baseUrl = "https://u-tad.blackboard.com/ultra/stream";

test("profile cookie evidence is advisory and never remotely verified", () => {
  const result = inspectProfileCookies(
    [
      {
        name: "web_client_cache_guid",
        value: "technical-cookie",
        expires: -1,
      },
    ],
    1_700_000_000,
  );

  assert.deepEqual(result, {
    profileEvidence: "present",
    liveCookieCount: 1,
    verified: false,
  });
});

test("expired and empty cookies provide no local session evidence", () => {
  assert.deepEqual(
    inspectProfileCookies(
      [
        { name: "session_id", value: "", expires: -1 },
        { name: "s_session_id", value: "expired", expires: 1 },
      ],
      1_700_000_000,
    ),
    {
      profileEvidence: "none",
      liveCookieCount: 0,
      verified: false,
    },
  );
});

test("classifies authenticated Blackboard and SSO destinations", () => {
  assert.equal(
    classifySessionDestination({
      currentUrl: baseUrl,
      baseUrl,
      title: "Courses",
      bodyText: "Course Content",
    }),
    "blackboard",
  );
  assert.equal(
    classifySessionDestination({
      currentUrl: baseUrl,
      baseUrl,
      title: "",
      bodyText: "",
    }),
    "unknown",
  );
  assert.equal(
    classifySessionDestination({
      currentUrl: "https://login.microsoftonline.com/common/oauth2/authorize",
      baseUrl,
      title: "Sign in",
      bodyText: "Enter your password",
    }),
    "login",
  );
  assert.equal(
    classifySessionDestination({
      currentUrl: "https://u-tad.blackboard.com/login",
      baseUrl,
      title: "Iniciar sesión",
      bodyText: "Contraseña",
    }),
    "login",
  );
  assert.equal(
    classifySessionDestination({
      currentUrl: baseUrl,
      baseUrl,
      title: "Blackboard",
      bodyText: "Sign in\nPassword",
    }),
    "login",
  );
});
