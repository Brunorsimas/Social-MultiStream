interface OnceEmitter {
  once(event: string, listener: () => void): unknown;
}

export function bindSseLifecycle(
  req: OnceEmitter,
  res: OnceEmitter,
  onDisconnect: () => void,
): void {
  let disconnected = false;
  const disconnectOnce = () => {
    if (disconnected) return;
    disconnected = true;
    onDisconnect();
  };

  // IncomingMessage "close" means that the request was fully received on
  // current Node versions. It does not reliably mean that an SSE client left.
  req.once("aborted", disconnectOnce);
  res.once("close", disconnectOnce);
  res.once("finish", disconnectOnce);
}
