// Test namespace init: reap only children of this private PID namespace.
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <sys/wait.h>
#include <unistd.h>

static volatile sig_atomic_t child = 0;
static void forward(int signal) { if (child > 0) kill(child, signal); }

int main(int argc, char** argv) {
  if (getpid() != 1 || argc < 2) {
    std::fputs("REFUSING: private PID namespace init must run as PID 1\n", stderr);
    return 125;
  }
  struct sigaction action = {};
  action.sa_handler = forward;
  sigemptyset(&action.sa_mask);
  sigaction(SIGINT, &action, nullptr);
  sigaction(SIGTERM, &action, nullptr);
  child = fork();
  if (child < 0) return 126;
  if (child == 0) {
    signal(SIGINT, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    execv(argv[1], argv + 1);
    _exit(127);
  }
  while (true) {
    int status = 0;
    const pid_t reaped = waitpid(-1, &status, 0);
    if (reaped < 0) { if (errno == EINTR) continue; return 126; }
    if (reaped == child) return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
  }
}
