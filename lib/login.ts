/**
 * Sign in to a site with the user's own login ID and password.
 *
 * The password is used once, inside an incognito browser context, and dropped:
 * it is never logged, stored, sealed into a token, or put in an error message.
 * A request that would carry it to any other site than the one being signed in
 * to is blocked, and sign-in stops. CAPTCHAs, one-time codes and sign-in on
 * another site (SSO) are not automated: the user is told to paste a cookie.
 */
import type { HTTPRequest, Page } from "puppeteer-core";
import { baseDomain } from "./company";

export interface Credentials { username: string; password: string }

export class SignInError extends Error {
  constructor(message: string, public kind: "no-form" | "failed" | "unsupported" | "unsafe") {
    super(message);
    this.name = "SignInError";
  }
}

/** Does this request carry the password (raw, URL-encoded or JSON-escaped) in its address or body? */
export function carriesSecret(url: string, body: string | undefined, secret: string): boolean {
  if (!secret) return false;
  const forms = [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret).replace(/%20/g, "+")];
  return forms.some((f) => f && (url.includes(f) || (body ?? "").includes(f)));
}

/**
 * Request guard installed before the first navigation: blocks any request that would send
 * the password to a host outside the site's own domain. Returns a function telling whether it fired.
 */
export function passwordGuard(page: Page, siteUrl: string, secret: string) {
  const site = baseDomain(new URL(siteUrl).hostname);
  let fired: string | null = null;
  const check = (req: HTTPRequest): "abort" | null => {
    let host = "";
    try {
      host = new URL(req.url()).hostname;
    } catch {
      return null;
    }
    if (baseDomain(host) !== site && carriesSecret(req.url(), req.postData(), secret)) {
      fired = host;
      return "abort";
    }
    return null;
  };
  return { check, fired: () => fired };
}

const LOGIN_TEXT = /^(log ?in|sign ?in|anmelden|einloggen|login \/ register|connexion|se connecter|accedi|iniciar sesi[óo]n|entrar|inloggen|zaloguj)$/i;

/** Mark the visible login fields on the page; returns what was found (no values). */
async function markFields(page: Page): Promise<{ pass: boolean; user: boolean; captcha: boolean; otp: boolean; host: string }> {
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const el = e as HTMLElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    document.querySelectorAll("[data-ss-user],[data-ss-pass],[data-ss-submit]").forEach((e) => {
      e.removeAttribute("data-ss-user"); e.removeAttribute("data-ss-pass"); e.removeAttribute("data-ss-submit");
    });
    const pass = [...document.querySelectorAll('input[type="password"]')].find(visible) as HTMLInputElement | undefined;
    const captcha = [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile')].some(visible);
    const otp = [...document.querySelectorAll('input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="totp" i],input[id*="otp" i],input[name*="mfa" i],input[name*="2fa" i]')].some(visible);
    let user: HTMLInputElement | undefined;
    if (pass) {
      pass.setAttribute("data-ss-pass", "1");
      const scope = pass.form ?? pass.closest("[role=dialog],dialog,section,div") ?? document.body;
      const candidates = [...scope.querySelectorAll("input")].filter((i) => visible(i) && /^(text|email|tel|)$/i.test(i.type) && i !== pass);
      // The login ID field is the visible text/email input closest before the password field.
      user = candidates.filter((i) => i.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING).pop() ?? candidates[0];
      user?.setAttribute("data-ss-user", "1");
      const buttons = [...scope.querySelectorAll('button,input[type="submit"]')].filter(visible) as HTMLElement[];
      const submit = buttons.find((b) => (b as HTMLButtonElement).type === "submit" && !/forgot|vergessen|register|registr/i.test(b.textContent ?? ""))
        ?? buttons.find((b) => /^(log ?in|sign ?in|anmelden|einloggen|weiter|continue|submit|connexion|accedi|entrar|inloggen)$/i.test((b.textContent ?? (b as HTMLInputElement).value ?? "").trim()));
      submit?.setAttribute("data-ss-submit", "1");
    }
    return { pass: !!pass, user: !!user, captcha, otp, host: location.hostname };
  });
}

/**
 * Sign in on `page` (already guarded, in an incognito context). Leaves the page signed in.
 * Messages never contain the login ID or password.
 */
export async function signIn(page: Page, siteUrl: string, creds: Credentials, guard: { fired: () => string | null }, say: (t: string) => void): Promise<void> {
  const site = baseDomain(new URL(siteUrl).hostname);
  say("Opening the sign-in page");
  await page.goto(siteUrl, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => undefined);
  let f = await markFields(page);
  if (!f.pass) {
    // Open the site's own sign-in form (a "Login" button or link).
    await page.evaluate((src) => {
      const re = new RegExp(src, "i");
      const el = [...document.querySelectorAll("a,button")].find((e) => re.test((e.textContent ?? "").trim())) as HTMLElement | undefined;
      el?.click();
    }, LOGIN_TEXT.source);
    for (let i = 0; i < 20 && !f.pass; i++) {
      await new Promise((r) => setTimeout(r, 500));
      f = await markFields(page).catch(() => f);
    }
  }
  if (!f.pass) throw new SignInError("I couldn't find a sign-in form on this site. Open the page that asks for your password, or use “Paste a cookie”.", "no-form");
  if (baseDomain(f.host) !== site) {
    throw new SignInError(`The sign-in form is on another site (${f.host}). For safety, your password is only typed into the site you asked for. Use “Paste a cookie” instead.`, "unsafe");
  }
  if (f.captcha) throw new SignInError("This site asks for a CAPTCHA at sign-in, which I can't do automatically. Use “Paste a cookie” instead.", "unsupported");
  if (!f.user) throw new SignInError("I found the password field but not the login ID field. Use “Paste a cookie” instead.", "no-form");

  say("Signing in");
  await page.type("[data-ss-user]", creds.username, { delay: 15 });
  await page.type("[data-ss-pass]", creds.password, { delay: 15 });
  const hasSubmit = await page.$("[data-ss-submit]");
  if (hasSubmit) await page.click("[data-ss-submit]").catch(() => page.focus("[data-ss-pass]").then(() => page.keyboard.press("Enter")));
  else {
    await page.focus("[data-ss-pass]");
    await page.keyboard.press("Enter");
  }

  // Signed in when the password field is gone; give the site up to 20 s.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (guard.fired()) throw new SignInError(`The site tried to send your password to ${guard.fired()}, another site. I stopped it. Use “Paste a cookie” instead.`, "unsafe");
    const now = await markFields(page).catch(() => null);
    if (now && !now.pass) {
      if (now.otp) throw new SignInError("The site asks for a one-time code after the password, which I can't do automatically. Use “Paste a cookie” instead.", "unsupported");
      say("Signed in");
      return;
    }
    if (now?.otp) throw new SignInError("The site asks for a one-time code after the password, which I can't do automatically. Use “Paste a cookie” instead.", "unsupported");
    if (now?.captcha) throw new SignInError("The site asks for a CAPTCHA after the password, which I can't do automatically. Use “Paste a cookie” instead.", "unsupported");
  }
  throw new SignInError("Sign-in didn't work. Check the login ID and password and try again.", "failed");
}

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (a !== b) throw new Error(`login: ${m}: ${String(a)} != ${String(b)}`);
  };
  eq(carriesSecret("https://x.com/a", '{"password":"p@ss w\\"rd"}', 'p@ss w"rd'), true, "json-escaped body");
  eq(carriesSecret("https://x.com/a", "user=a&pass=p%40ss+w%22rd", 'p@ss w"rd'), true, "form-encoded body");
  eq(carriesSecret("https://x.com/a?pw=p%40ss", undefined, "p@ss"), true, "in the address");
  eq(carriesSecret("https://x.com/a", "user=a", "p@ss"), false, "not present");
  return "login ok (4 checks)";
}
