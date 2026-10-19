// Linux qualification supervisor. ptrace observes only descendants we fork;
// stopped tracees pin identity at exec. Subreaping permits bounded recovery
// even when the worker dies or a PTY descendant creates a new session.
#include <sys/ptrace.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <vector>

static volatile sig_atomic_t cancelled = 0;
static void cancel(int) { cancelled = 1; }
static std::string quoted(const std::string& text) {
  std::string out = "\"";
  for (unsigned char c : text) {
    if (c == '\\' || c == '"') { out += '\\'; out += c; }
    else if (c >= 32 && c < 127) out += c;
    else { char escape[7]; snprintf(escape, sizeof escape, "\\u%04x", c); out += escape; }
  }
  return out + '"';
}
static std::string read(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), {});
}
static bool matches(const char* key, const std::string& exe, const std::string& args) {
  const char* raw = getenv(key);
  if (!raw) return false;
  std::string list(raw);
  size_t begin = 0;
  while (begin < list.size()) {
    size_t end = list.find('\n', begin);
    std::string path = list.substr(begin, end == std::string::npos ? end : end - begin);
    if (!path.empty() && (exe == path || args.find(std::string("\0", 1) + path + std::string("\0", 1)) != std::string::npos)) return true;
    if (end == std::string::npos) break;
    begin = end + 1;
  }
  return false;
}
int main(int argc, char** argv) {
  if (argc < 4) return 125;
  FILE* log = fopen(argv[1], "wx");
  if (!log || chmod(argv[1], 0600)) return 125;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1)) return 125;
  signal(SIGTERM, cancel); signal(SIGINT, cancel);
  pid_t root = fork();
  if (root < 0) return 125;
  if (!root) {
    signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL);
    if (ptrace(PTRACE_TRACEME, 0, nullptr, nullptr)) _exit(125);
    raise(SIGSTOP);
    execv(argv[3], argv + 3); _exit(127);
  }
  std::map<pid_t, bool> owned{{root, false}};
  bool recovering = false, failed = false, observed = false;
  int result = 125;
  auto deadline = std::chrono::steady_clock::now();
  while (!owned.empty()) {
    if (cancelled && !recovering) { recovering = true; deadline = std::chrono::steady_clock::now(); }
    if (recovering) {
      for (auto [pid, vendor] : owned) kill(pid, SIGKILL);
    }
    int status = 0;
    pid_t pid = waitpid(-1, &status, __WALL | WNOHANG);
    if (pid == 0) {
      if (recovering && std::chrono::steady_clock::now() - deadline > std::chrono::seconds(3)) { failed = true; break; }
      usleep(1000); continue;
    }
    if (pid < 0) { if (errno == EINTR) continue; failed = true; break; }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      owned.erase(pid);
      if (pid == root) {
        result = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        recovering = true; deadline = std::chrono::steady_clock::now();
      }
      continue;
    }
    if (!WIFSTOPPED(status)) continue;
    const unsigned event = static_cast<unsigned>(status) >> 16;
    if (ptrace(PTRACE_SETOPTIONS, pid, nullptr,
      PTRACE_O_TRACEEXEC | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACECLONE | PTRACE_O_EXITKILL)) {
      failed = true; recovering = true; deadline = std::chrono::steady_clock::now();
      kill(pid, SIGKILL); continue;
    }
    if (event == PTRACE_EVENT_FORK || event == PTRACE_EVENT_VFORK || event == PTRACE_EVENT_CLONE) {
      unsigned long child = 0;
      if (ptrace(PTRACE_GETEVENTMSG, pid, nullptr, &child) == 0) owned[child] = owned[pid];
      else failed = true;
    }
    if (event == PTRACE_EVENT_EXEC) {
      // A non-leader thread may exec and take the leader PID.
      unsigned long previous = 0;
      if (ptrace(PTRACE_GETEVENTMSG, pid, nullptr, &previous) == 0 && previous != static_cast<unsigned long>(pid)) owned.erase(previous);
      char buffer[8192];
      std::string base = "/proc/" + std::to_string(pid);
      ssize_t size = readlink((base + "/exe").c_str(), buffer, sizeof buffer);
      if (size <= 0) failed = true;
      else {
        observed = true;
        std::string exe(buffer, size), args = std::string("\0", 1) + read(base + "/cmdline");
        if (matches("XCLI_VENDOR_PATHS", exe, args)) owned[pid] = true;
        if (matches("XCLI_HARNESS_ENTRYPOINTS", exe, args)) owned[pid] = false;
        // argv is inspected only in memory; never persisted.
        fprintf(log, "{\"pid\":%d,\"path\":%s,\"tag\":\"%s\"}\n", pid, quoted(exe).c_str(), owned[pid] ? "vendor" : "harness");
        fflush(log);
      }
    }
    int signal = WSTOPSIG(status);
    if (signal == SIGSTOP || signal == SIGTRAP) signal = 0;
    if (ptrace(PTRACE_CONT, pid, nullptr, signal) && errno != ESRCH) failed = true;
  }
  fclose(log);
  FILE* summary = fopen(argv[2], "wx");
  if (!summary) return 125;
  chmod(argv[2], 0600);
  fprintf(summary, "{\"processRecovery\":%s,\"observed\":%s}\n", !failed && owned.empty() ? "true" : "false", observed ? "true" : "false");
  fclose(summary);
  return result;
}
