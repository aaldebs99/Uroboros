import { CircleCheck, Loader, TriangleAlert, WifiOff } from "lucide-react";

import { useHealth } from "@/api/client";
import { Badge } from "@/components/ui/badge";

/** Live API health: polls `/api/health`, and says which dependencies are down when degraded. */
export function HealthBadge() {
  const health = useHealth();

  if (health.isPending) {
    return (
      <Badge variant="outline" role="status" className="text-muted-foreground">
        <Loader className="animate-spin" aria-hidden />
        <span>Checking</span>
      </Badge>
    );
  }
  if (health.isError) {
    return (
      <Badge variant="destructive" role="status">
        <WifiOff aria-hidden />
        <span>Unreachable</span>
      </Badge>
    );
  }
  if (health.data.status === "ok") {
    return (
      <Badge variant="success" role="status">
        <CircleCheck aria-hidden />
        <span>Healthy</span>
      </Badge>
    );
  }
  return (
    <Badge variant="warning" role="status">
      <TriangleAlert aria-hidden />
      <span>Degraded</span>
      {health.data.failing.map((name) => (
        <span key={name} className="rounded-sm bg-warning/15 px-1 font-mono text-[0.7rem]">
          {name}
        </span>
      ))}
    </Badge>
  );
}
