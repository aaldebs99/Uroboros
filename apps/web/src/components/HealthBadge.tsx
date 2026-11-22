import { CircleCheck, Loader, TriangleAlert, WifiOff } from "lucide-react";

import { useReadiness } from "@/api/client";
import { Badge } from "@/components/ui/badge";

/**
 * Live API readiness: polls `/api/ready`, says when the replica is still starting (migrating),
 * and which dependencies are down when degraded.
 */
export function HealthBadge() {
  const readiness = useReadiness();

  if (readiness.isPending) {
    return (
      <Badge variant="outline" role="status" className="text-muted-foreground">
        <Loader className="animate-spin" aria-hidden />
        <span>Checking</span>
      </Badge>
    );
  }
  if (readiness.isError) {
    return (
      <Badge variant="destructive" role="status">
        <WifiOff aria-hidden />
        <span>Unreachable</span>
      </Badge>
    );
  }
  const { status, failing } = readiness.data;
  switch (status) {
    case "ok":
      return (
        <Badge variant="success" role="status">
          <CircleCheck aria-hidden />
          <span>Healthy</span>
        </Badge>
      );
    case "starting":
      return (
        <Badge variant="outline" role="status" className="text-muted-foreground">
          <Loader className="animate-spin" aria-hidden />
          <span>Starting</span>
        </Badge>
      );
    case "degraded":
      return (
        <Badge variant="warning" role="status">
          <TriangleAlert aria-hidden />
          <span>Degraded</span>
          {failing.map((name) => (
            <span key={name} className="rounded-sm bg-warning/15 px-1 font-mono text-[0.7rem]">
              {name}
            </span>
          ))}
        </Badge>
      );
  }
}
