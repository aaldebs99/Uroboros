import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithQuery, stubApi } from "../test/render";
import { HealthBadge } from "./HealthBadge";

describe("HealthBadge", () => {
  it("shows Healthy when the API reports ok", async () => {
    stubApi({ "/api/health": () => Response.json({ status: "ok", failing: [] }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("shows Degraded and the failing dependency", async () => {
    stubApi({ "/api/health": () => Response.json({ status: "degraded", failing: ["valkey"] }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("valkey")).toBeInTheDocument();
  });

  it("shows Unreachable when the request fails", async () => {
    stubApi({});
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows Unreachable when the body fails the schema", async () => {
    stubApi({ "/api/health": () => Response.json({ status: "weird" }) });
    renderWithQuery(<HealthBadge />);

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows Checking while the first request is in flight", () => {
    stubApi({ "/api/health": () => Response.json({ status: "ok", failing: [] }) });
    renderWithQuery(<HealthBadge />);

    expect(screen.getByText("Checking")).toBeInTheDocument();
  });
});
