import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithQuery, stubApi } from "../test/render";
import { HealthBadge } from "./HealthBadge";

describe("HealthBadge", () => {
  it("shows Healthy when the API reports ok", async () => {
    stubApi({ "/api/ready": () => Response.json({ status: "ok", failing: [] }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("shows Degraded and the failing dependency", async () => {
    stubApi({ "/api/ready": () => Response.json({ status: "degraded", failing: ["valkey"] }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("valkey")).toBeInTheDocument();
  });

  it("shows Starting while the replica has not attached its database (503 starting)", async () => {
    stubApi({
      "/api/ready": () => Response.json({ status: "starting", failing: [] }, { status: 503 }),
    });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Starting")).toBeInTheDocument();
  });

  it("shows Unreachable on a 503 that is not a readiness report", async () => {
    stubApi({ "/api/ready": () => new Response("bad gateway", { status: 503 }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows Unreachable when the request fails", async () => {
    stubApi({});
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows Unreachable when the body fails the schema", async () => {
    stubApi({ "/api/ready": () => Response.json({ status: "weird" }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows Checking while the first request is in flight", () => {
    stubApi({ "/api/ready": () => Response.json({ status: "ok", failing: [] }) });
    renderWithQuery(<HealthBadge />);

    expect(screen.getByText("Checking")).toBeInTheDocument();
  });
});
