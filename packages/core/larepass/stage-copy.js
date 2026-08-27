/** Stage chrome copy matches dsh conversation EN / design literals, not locale. */

export const STAGE_COPY = {
  think: "Think",
  contextInjection: "Context injection",
  contextRecall: "Session recall",
  retry: {
    active: "Retrying model request",
    cancelled: "Model request retry cancelled",
    started: "Retried model request",
    scheduled: "Waiting to retry model request",
    status: "{label} ({retry}/{maximum}) · {seconds}s",
    delay: "Retry delay: ",
    failure: "Failure reason: ",
  },
};
