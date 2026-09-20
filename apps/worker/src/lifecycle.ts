export function startDispatcher(
  dispatcher: { tick(): Promise<void> },
  onError: (error: Error) => void,
  intervalMs = 1000,
) {
  let active: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (active) return;
    active = dispatcher
      .tick()
      .catch(onError)
      .finally(() => {
        active = undefined;
      });
  }, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await active;
    },
  };
}
