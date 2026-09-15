// The runner names a ticket's worktree `.claude/worktrees/<number>-<title
// slug>`; the dashboard and the stop hook both read the ticket back from that
// path. The directory is part of the match: a repo of its own named
// `2024-migration` is not ticket 2024.
export const ticketOfPath = (path: string): number | null => {
  const m = /\/\.claude\/worktrees\/(\d+)-[^/]*$/.exec(path);
  return m ? Number(m[1]) : null;
};

// The 8-character prefix `claude agents` prints and `claude stop` accepts.
export const shortSessionId = (sessionId: string): string => sessionId.slice(0, 8);
