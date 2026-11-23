import type { Logger } from "pino";
import type { NotifyJob } from "../downloads/queues.ts";
import type { PushService } from "../push/service.ts";

/** The `notify` queue's consumer: one push to all of a person's devices; dropped while push is off. */
export function notifyProcessor(push: PushService, logger: Logger) {
  return async (job: { data: NotifyJob }): Promise<void> => {
    const pusher = await push.pusher();
    if (pusher === null) return;
    const sent = await pusher.notify(job.data.userId, job.data.message, job.data.urgency);
    if (sent.failed > 0) logger.warn({ sent, userId: job.data.userId }, "some pushes failed");
  };
}
