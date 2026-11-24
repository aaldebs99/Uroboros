import { describe, expect, it } from "vitest";

import { LOGIN_SITES, LoginSite, SiteLoginBody } from "./index.ts";

describe("site logins", () => {
  it("lists the sites yt-dlp signs in to, sorted, without YouTube", () => {
    expect(LOGIN_SITES).toContain("vimeo");
    expect(LOGIN_SITES).not.toContain("youtube");
    expect([...LOGIN_SITES]).toEqual([...LOGIN_SITES].sort());
    expect(LoginSite.safeParse("not-a-site").success).toBe(false);
  });

  it("takes any printable username and password, but no control characters or empties", () => {
    expect(SiteLoginBody.safeParse({ username: "me@x.org", password: 'a "b" #c\\' }).success).toBe(
      true,
    );
    for (const body of [
      { username: "", password: "x" },
      { username: "me", password: "" },
      { username: "me", password: "line\nbreak" },
      { username: "tab\there", password: "x" },
    ]) {
      expect(SiteLoginBody.safeParse(body).success).toBe(false);
    }
  });
});
