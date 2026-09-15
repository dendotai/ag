// The runner names a ticket's worktree `<ticket number>-<title slug>`; the
// dashboard and the stop hook both read the ticket back from that path.
export const ticketOfPath = (path: string): number | null => {
  const m = /\/(\d+)-[^/]*$/.exec(path);
  return m ? Number(m[1]) : null;
};

// The 8-character prefix `claude agents` prints and `claude stop` accepts.
export const shortSessionId = (sessionId: string): string => sessionId.slice(0, 8);
