import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { SidebarNav } from "../components/SidebarNav";
import { createAppRouter } from "../router";
import { GroupPage } from "./GroupPage";
import { Groups } from "./GroupsPage";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1);
const BOB = id(2);
const CAT = id(3);
const DAN = id(4);
const G = id(10);
const VIDEO = id(20);
const LIST = id(21);
const SHARE = id(30);

const me = {
  id: ME,
  displayName: "Alice",
  email: null,
  role: "member",
  method: "local",
  isBootstrap: false,
};
const member = (n: string, uid: string, role: "manager" | "member", over = {}) => ({
  id: uid,
  name: n,
  handle: n.toLowerCase(),
  role,
  disabled: false,
  addedAt: "2026-11-24T10:00:00.000Z",
  ...over,
});
const detail = (role: "manager" | "member", over = {}) => ({
  id: G,
  name: "Family",
  role,
  members: [
    member("Alice", ME, role),
    member("Bob", BOB, "member"),
    member("Cat", CAT, "member", { disabled: true }),
  ],
  createdAt: "2026-11-24T10:00:00.000Z",
  ...over,
});
const shared = [
  {
    shareId: id(31),
    kind: "entry",
    id: VIDEO,
    title: "Picnic",
    thumbnailUrl: null,
    previewUrl: null,
    count: null,
    owner: "Alice",
    sharedAt: "2026-11-24T10:00:00.000Z",
    expiresAt: null,
    mine: true,
  },
  {
    shareId: SHARE,
    kind: "playlist",
    id: LIST,
    title: "Holiday",
    thumbnailUrl: null,
    previewUrl: null,
    count: 4,
    owner: "Bob",
    sharedAt: "2026-11-24T10:00:00.000Z",
    expiresAt: null,
    mine: false,
  },
];
const directory = {
  users: [
    { id: BOB, name: "Bob", handle: "bob" },
    { id: DAN, name: "Dan", handle: "dan" },
  ],
  groups: [{ id: G, name: "Family", members: 2 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

function groupApi(role: "manager" | "member", extra: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /api/me": () => Response.json(me),
    [`GET /api/groups/${G}`]: () => Response.json(detail(role)),
    [`GET /api/groups/${G}/shares`]: () => Response.json(shared),
    "GET /api/directory": () => Response.json(directory),
    ...extra,
  });
}

async function showGroup(role: "manager" | "member", extra: Parameters<typeof fakeApi>[0] = {}) {
  const calls = groupApi(role, extra);
  await renderInRouter(
    <>
      <GroupPage groupId={G} />
      <Toaster />
    </>,
  );
  await screen.findByRole("heading", { name: "Family" });
  return calls;
}

function renderApp(path: string, routes: Parameters<typeof fakeApi>[0]) {
  const calls = fakeApi({
    "GET /api/ready": () => Response.json({ status: "ok", failing: [] }),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
    "GET /api/me": () => Response.json(me),
    ...routes,
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router };
}

describe("Settings › Groups", () => {
  it("is a Settings view with an address of its own, and no longer a Shared one", async () => {
    renderApp("/settings/groups", {
      "GET /api/groups": () => Response.json([]),
      "GET /api/shared": () => Response.json([]),
    });
    const tabs = await screen.findByRole("navigation", { name: "Settings views" });
    expect(within(tabs).getByRole("link", { name: "Groups" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(await screen.findByText("No groups yet")).toBeInTheDocument();
  });

  it("leaves Shared with its two views", async () => {
    renderApp("/shared", { "GET /api/shared": () => Response.json([]) });
    const tabs = await screen.findByRole("navigation", { name: "Shared views" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["With me", "By me"]);
  });

  it("sends the old Shared › Groups addresses (in notifications already sent) here", async () => {
    const { router } = renderApp(`/shared/groups/${G}`, {
      [`GET /api/groups/${G}`]: () => Response.json(detail("member")),
      [`GET /api/groups/${G}/shares`]: () => Response.json([]),
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/settings/groups/${G}`);
    });
    expect(await screen.findByRole("heading", { name: "Family" })).toBeInTheDocument();
    await router.navigate({ to: "/shared/groups" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/groups");
    });
  });

  it("points an empty list at New group", async () => {
    fakeApi({ "GET /api/groups": () => Response.json([]) });
    await renderInRouter(<Groups />);
    expect(await screen.findByText("No groups yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
  });

  it("lists the person's groups, each a link to its page", async () => {
    fakeApi({
      "GET /api/groups": () =>
        Response.json([
          { id: G, name: "Family", role: "manager", members: 3 },
          { id: id(11), name: "Club", role: "member", members: 1 },
        ]),
    });
    await renderInRouter(<Groups />);
    // The whole row is the link (a 44px+ target on phones), not only its name.
    const family = await screen.findByRole("link", { name: /^Family/ });
    expect(family).toHaveAttribute("href", `/settings/groups/${G}`);
    expect(within(family).getByText("Manager")).toBeInTheDocument();
    expect(within(family).getByText("3 people")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /^Club/ })).getByText("1 person")).toBeVisible();
  });

  it("makes a group by name and opens its page", async () => {
    const calls = fakeApi({
      "GET /api/ready": () => Response.json({ status: "ok", failing: [] }),
      "GET /api/info": () =>
        Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
      "GET /api/me": () => Response.json(me),
      "GET /api/groups": () => Response.json([]),
      "POST /api/groups": () =>
        Response.json(detail("manager", { members: [member("Alice", ME, "manager")] }), {
          status: 201,
        }),
      [`GET /api/groups/${G}`]: () =>
        Response.json(detail("manager", { members: [member("Alice", ME, "manager")] })),
      [`GET /api/groups/${G}/shares`]: () => Response.json([]),
      "GET /api/directory": () => Response.json(directory),
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/settings/groups"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog", { name: "New group" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Family");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/settings/groups/${G}`);
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Family" });
    expect(await screen.findByRole("heading", { name: "Family" })).toBeInTheDocument();
  });
});

describe("a group's page", () => {
  it("shows a manager the picker, Rename, Delete and a menu on everyone else's row", async () => {
    await showGroup("manager");
    expect(screen.getByLabelText("Add people")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Alice" })).not.toBeInTheDocument();
    const members = screen.getByRole("region", { name: "Members" });
    expect(within(members).getAllByText("Manager")).toHaveLength(1);
    expect(within(members).getByText("Disabled")).toBeInTheDocument();
  });

  it("shows a member only Leave", async () => {
    await showGroup("member");
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Add people")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Bob" })).not.toBeInTheDocument();
  });

  it("adds people from the directory, never those already in", async () => {
    const calls = await showGroup("manager", {
      [`POST /api/groups/${G}/members`]: () => Response.json(detail("manager")),
    });
    await userEvent.type(screen.getByLabelText("Add people"), "b");
    expect(screen.queryByRole("button", { name: /Add Bob/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Add people"));
    await userEvent.type(screen.getByLabelText("Add people"), "da");
    expect(screen.queryByRole("button", { name: /Add Family/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Add Dan/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ userIds: [DAN] });
    });
  });

  it("makes someone a manager, and removes them after asking", async () => {
    const calls = await showGroup("manager", {
      [`PATCH /api/groups/${G}/members/${BOB}`]: () => Response.json(detail("manager")),
      [`DELETE /api/groups/${G}/members/${BOB}`]: () => new Response(null, { status: 204 }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Actions for Bob" }));
    await userEvent.click(await screen.findByText("Make manager"));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ role: "manager" });
    });
    await userEvent.click(screen.getByRole("button", { name: "Actions for Bob" }));
    await userEvent.click(await screen.findByText("Remove"));
    const ask = await screen.findByRole("alertdialog");
    expect(
      within(ask).getByText(/their videos shared with Family stop being shared/i),
    ).toBeVisible();
    await userEvent.click(within(ask).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });

  it("leaves after asking, and shows why when the server refuses", async () => {
    const calls = await showGroup("manager", {
      [`DELETE /api/groups/${G}/members/${ME}`]: () =>
        Response.json(
          { code: "conflict", message: "Make someone else a manager first, or delete the group" },
          { status: 409 },
        ),
    });
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    const ask = await screen.findByRole("alertdialog");
    await userEvent.click(within(ask).getByRole("button", { name: "Leave" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
    expect(await screen.findByText(/Make someone else a manager first/)).toBeInTheDocument();
  });

  it("lists what is shared with the group, yours opening in your library", async () => {
    await showGroup("member");
    const region = screen.getByRole("region", { name: "Shared with this group" });
    expect(await within(region).findByRole("link", { name: "Picnic" })).toHaveAttribute(
      "href",
      `/library/${VIDEO}`,
    );
    expect(within(region).getByRole("link", { name: "Holiday" })).toHaveAttribute(
      "href",
      `/shared/${SHARE}`,
    );
    expect(within(region).getByText("yours")).toBeInTheDocument();
    expect(within(region).getByText("from Bob · 4 videos")).toBeInTheDocument();
  });
});

describe("leaving or deleting a group", () => {
  function showInApp(role: "manager" | "member") {
    const calls = fakeApi({
      "GET /api/ready": () => Response.json({ status: "ok", failing: [] }),
      "GET /api/info": () =>
        Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
      "GET /api/me": () => Response.json(me),
      "GET /api/groups": () => Response.json([]),
      [`GET /api/groups/${G}`]: () => Response.json(detail(role)),
      [`GET /api/groups/${G}/shares`]: () => Response.json([]),
      "GET /api/directory": () => Response.json(directory),
      [`DELETE /api/groups/${G}`]: () => new Response(null, { status: 204 }),
      [`DELETE /api/groups/${G}/members/${ME}`]: () => new Response(null, { status: 204 }),
    });
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: [`/settings/groups/${G}`] }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { calls, router };
  }
  const askedAfterDelete = (calls: { method: string; path: string }[]) => {
    const at = calls.findIndex((c) => c.method === "DELETE");
    return calls
      .slice(at + 1)
      .filter((c) => c.method === "GET" && c.path.startsWith(`/api/groups/${G}`));
  };

  it("leaving goes straight back to the list, without asking for the group again", async () => {
    const { calls, router } = showInApp("member");
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/groups");
    });
    expect(await screen.findByText("No groups yet")).toBeInTheDocument();
    expect(askedAfterDelete(calls)).toEqual([]);
  });

  it("deleting goes straight back to the list, without asking for the group again", async () => {
    const { calls, router } = showInApp("manager");
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/groups");
    });
    expect(askedAfterDelete(calls)).toEqual([]);
  });
});

describe("Admin › Groups in the navigation", () => {
  it("is listed under Admin for admins", async () => {
    fakeApi({
      "GET /api/info": () =>
        Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
    });
    await renderInRouter(<SidebarNav isAdmin />);
    // Settings › Groups (your groups) and Admin › Groups (everyone's).
    const hrefs = screen
      .getAllByRole("link", { name: "Groups" })
      .map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(["/settings/groups", "/admin/groups"]);
  });
});
