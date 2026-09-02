function isLiveCookie(cookie, now) {
  return Boolean(
    cookie &&
      typeof cookie.value === "string" &&
      cookie.value !== "" &&
      (cookie.expires === -1 ||
        (typeof cookie.expires === "number" && cookie.expires > now)),
  );
}

export function inspectProfileCookies(cookies, now = Math.floor(Date.now() / 1000)) {
  const liveCookieCount = Array.isArray(cookies)
    ? cookies.filter((cookie) => isLiveCookie(cookie, now)).length
    : 0;

  return {
    profileEvidence: liveCookieCount > 0 ? "present" : "none",
    liveCookieCount,
    verified: false,
  };
}

export function classifySessionDestination({
  currentUrl,
  baseUrl,
  title = "",
  bodyText = "",
  hasPasswordField = false,
}) {
  let current;
  let base;
  try {
    current = new URL(currentUrl);
    base = new URL(baseUrl);
  } catch {
    return "unknown";
  }

  const loginText = /(?:sign[ -]?in|log[ -]?in|iniciar sesión|iniciar sesion)/i;
  const passwordText = /(?:password|contraseña)/i;
  const loginPath = /(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$)/i;
  const blackboardContent = /(?:course content|contenido del curso|courses|cursos|activity|actividad|calendar|calendario|gradebook|calificaciones|messages|mensajes|organizations|organizaciones|institution page|página institucional|mi blackboard|my blackboard)/i;
  const identityProvider =
    /(?:^|\.)(?:microsoftonline\.com|okta\.com|auth0\.com|accounts\.google\.com)$/i.test(
      current.hostname,
    );

  if (
    identityProvider ||
    (current.origin !== base.origin &&
      (loginPath.test(current.pathname) ||
        loginText.test(title) ||
        (loginText.test(bodyText) &&
          (passwordText.test(bodyText) || hasPasswordField))))
  ) {
    return "login";
  }

  if (current.origin === base.origin) {
    if (
      loginPath.test(current.pathname) ||
      loginText.test(title) ||
      (loginText.test(bodyText) &&
        (passwordText.test(bodyText) || hasPasswordField))
    ) {
      return "login";
    }
    if (blackboardContent.test(`${title}\n${bodyText}`)) {
      return "blackboard";
    }
    return "unknown";
  }

  if (
    loginPath.test(current.pathname) ||
    loginText.test(title) ||
    (loginText.test(bodyText) &&
      (passwordText.test(bodyText) || hasPasswordField))
  ) {
    return "login";
  }

  return "unknown";
}

export function safePageUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "unknown";
  }
}
