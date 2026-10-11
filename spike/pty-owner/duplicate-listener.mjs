import net from 'node:net';
// Transient helper only: no PTY, no publication. Node IPC duplicates a server
// handle, leaving fd 3 in the owner untouched and therefore non-CLOEXEC.
const server = net.createServer();
server.listen({ fd: 3 }, () => {
  process.send({ listener: true }, server, error => {
    if (error) throw error;
    server.close(() => process.exit(0));
  });
});
