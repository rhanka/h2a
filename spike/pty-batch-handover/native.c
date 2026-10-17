#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#ifdef __APPLE__
#include <util.h>
#include <libproc.h>
#include <sys/event.h>
#else
#include <pty.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#endif
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

/* Darwin has neither socket type flags nor MSG_CMSG_CLOEXEC. */
#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif
#ifndef MSG_CMSG_CLOEXEC
#define MSG_CMSG_CLOEXEC 0
#endif
#ifndef GUARDIAN_MAIN
static int socket_pair(int type, int fds[2], int nonblock) {
  if (socketpair(AF_UNIX, type, 0, fds)) return -1;
  for (int i = 0; i < 2; i++) {
    if (fcntl(fds[i], F_SETFD, FD_CLOEXEC) < 0 ||
        (nonblock && fcntl(fds[i], F_SETFL, O_NONBLOCK) < 0)) {
      int saved = errno; close(fds[0]); close(fds[1]); errno = saved; return -1;
    }
  }
  return 0;
}
#endif

#ifdef GUARDIAN_MAIN
static volatile sig_atomic_t stopping;
static void stop_signal(int sig) { (void)sig; stopping = 1; }

int main(int argc, char **argv) {
  if (argc < 4) return 125;
  int legacy = atoi(argv[1]);
  pid_t expected = (pid_t)atoi(argv[2]);
  struct sigaction action = { .sa_handler = stop_signal };
  sigemptyset(&action.sa_mask);
  sigaction(SIGHUP, &action, NULL);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGUSR2, &action, NULL);
  signal(SIGPIPE, SIG_IGN);
  signal(SIGTTOU, SIG_IGN);
#ifdef __linux__
  /* Negative control only: the real design has no parent-death dependency. */
  if (legacy && prctl(PR_SET_PDEATHSIG, SIGUSR2) < 0) return 125;
#endif
  if (legacy && getppid() != expected) return 125;
  if (setsid() < 0 || ioctl(0, TIOCSCTTY, 0) < 0) return 125;
  int gate[2];
  if (pipe(gate) < 0) return 125;
  if (fcntl(gate[0], F_SETFD, FD_CLOEXEC) < 0 || fcntl(gate[1], F_SETFD, FD_CLOEXEC) < 0) return 125;
  pid_t cli = fork();
  if (cli < 0) return 125;
  if (cli == 0) {
    close(gate[1]);
    close(3);
    setpgid(0, 0);
    char byte;
    if (read(gate[0], &byte, 1) != 1) _exit(125);
    close(gate[0]);
    signal(SIGHUP, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    signal(SIGUSR2, SIG_DFL);
    signal(SIGPIPE, SIG_DFL);
    signal(SIGTTOU, SIG_DFL);
    execv(argv[3], argv + 3);
    _exit(127);
  }
  close(gate[0]);
  setpgid(cli, cli);
  if (tcsetpgrp(0, cli) < 0) stopping = 1;
  if (write(gate[1], "G", 1) != 1) stopping = 1;
  close(gate[1]);
  char packet[256];
  int n = snprintf(packet, sizeof(packet), "{\"type\":\"born\",\"pid\":%d,\"guardian\":%d}\n", cli, getpid());
  if (send(3, packet, (size_t)n, MSG_NOSIGNAL) != n) stopping = 1;
  int status = 0, main_done = 0, children_done = 0, delivered = 0;
  for (;;) {
    if (stopping) kill(-cli, SIGKILL); /* Only the group this guardian created. */
    int found_status;
    pid_t found;
    while ((found = waitpid(-1, &found_status, WNOHANG)) > 0) {
      if (found == cli) { status = found_status; main_done = 1; }
    }
    children_done = found == -1 && errno == ECHILD;
    if (main_done && !delivered) {
      n = snprintf(packet, sizeof(packet),
        "{\"type\":\"exit\",\"pid\":%d,\"guardian\":%d,\"raw\":%d,\"code\":%d,\"signal\":%d}\n",
        cli, getpid(), status, WIFEXITED(status) ? WEXITSTATUS(status) : -1,
        WIFSIGNALED(status) ? WTERMSIG(status) : 0);
      if (send(3, packet, (size_t)n, MSG_NOSIGNAL) == n) delivered = 1;
      else stopping = 1;
    }
    if (stopping && main_done && children_done) break;
    struct pollfd pfd = { .fd = 3, .events = POLLIN };
    int polled = poll(&pfd, 1, 2);
    if (polled > 0) {
      char command;
      ssize_t got = recv(3, &command, 1, 0);
      if (got <= 0 || command == 'K') stopping = 1;
      if (got == 1 && command == 'A' && main_done && children_done) break;
    }
  }
  if (WIFSIGNALED(status)) {
    int sig = WTERMSIG(status);
    signal(sig, SIG_DFL);
    raise(sig);
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 125;
}
#else
#include <node_api.h>

#define MAX_FDS 128
#define MAX_PACKET 65536
#define NAPI(call) do { if ((call) != napi_ok) { napi_throw_error(env, NULL, "N-API argument failure"); return NULL; } } while (0)
static napi_value fail(napi_env env, const char *op) {
  char message[256];
  snprintf(message, sizeof(message), "%s: %s", op, strerror(errno));
  napi_throw_error(env, NULL, message);
  return NULL;
}
static napi_value integer(napi_env env, int n) { napi_value v; napi_create_int32(env, n, &v); return v; }
static void prop(napi_env env, napi_value obj, const char *key, napi_value value) { napi_set_named_property(env, obj, key, value); }
static int number(napi_env env, napi_value v) { int32_t n = -1; napi_get_value_int32(env, v, &n); return n; }
static napi_value nothing(napi_env env) { napi_value v; napi_get_null(env, &v); return v; }
static char *string(napi_env env, napi_value v) {
  size_t n;
  if (napi_get_value_string_utf8(env, v, NULL, 0, &n) != napi_ok) return NULL;
  char *s = malloc(n + 1);
  if (s && napi_get_value_string_utf8(env, v, s, n + 1, &n) != napi_ok) { free(s); return NULL; }
  return s;
}
static napi_value pair(napi_env env, napi_callback_info info) {
  (void)info;
  int fds[2];
  /* Connected datagrams preserve message + SCM_RIGHTS boundaries on both OSes.
     The guardian uses a separate STREAM pair for reliable last-owner EOF. */
  if (socket_pair(SOCK_DGRAM, fds, 1)) return fail(env, "socketpair");
  napi_value result;
  NAPI(napi_create_array_with_length(env, 2, &result));
  napi_set_element(env, result, 0, integer(env, fds[0]));
  napi_set_element(env, result, 1, integer(env, fds[1]));
  return result;
}
static napi_value send_packet(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  char *text = string(env, args[1]);
  if (!text) { errno = EINVAL; return fail(env, "send text"); }
  uint32_t count = 0;
  NAPI(napi_get_array_length(env, args[2], &count));
  if (count > MAX_FDS || strlen(text) >= MAX_PACKET) { free(text); errno = EMSGSIZE; return fail(env, "send bounds"); }
  int fds[MAX_FDS];
  for (uint32_t i = 0; i < count; i++) { napi_value v; napi_get_element(env, args[2], i, &v); fds[i] = number(env, v); }
  struct iovec iov = { .iov_base = text, .iov_len = strlen(text) };
  char control[CMSG_SPACE(sizeof(fds))] = {0};
  struct msghdr msg = { .msg_iov = &iov, .msg_iovlen = 1 };
  if (count) {
    msg.msg_control = control;
    msg.msg_controllen = CMSG_SPACE(count * sizeof(int));
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type = SCM_RIGHTS;
    cmsg->cmsg_len = CMSG_LEN(count * sizeof(int));
    memcpy(CMSG_DATA(cmsg), fds, count * sizeof(int));
  }
  ssize_t n = sendmsg(number(env, args[0]), &msg, MSG_NOSIGNAL);
  free(text);
  if (n < 0) return fail(env, "sendmsg SCM_RIGHTS");
  return integer(env, (int)n);
}
static napi_value receive_packet(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  char text[MAX_PACKET], control[CMSG_SPACE(MAX_FDS * sizeof(int))];
  struct iovec iov = { .iov_base = text, .iov_len = sizeof(text) };
  struct msghdr msg = { .msg_iov = &iov, .msg_iovlen = 1, .msg_control = control, .msg_controllen = sizeof(control) };
  ssize_t n = recvmsg(number(env, args[0]), &msg, MSG_CMSG_CLOEXEC);
  if (n < 0 && (errno == EAGAIN || errno == EINTR)) return nothing(env);
  if (n < 0) return fail(env, "recvmsg");
  int fds[MAX_FDS], count = 0;
  for (struct cmsghdr *c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
    if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
      int k = (int)((c->cmsg_len - CMSG_LEN(0)) / sizeof(int));
      if (k < 0 || count + k > MAX_FDS) { errno = EMSGSIZE; return fail(env, "received FD bounds"); }
      memcpy(fds + count, CMSG_DATA(c), (size_t)k * sizeof(int));
      count += k;
    }
  }
  for (int i = 0; i < count; i++) {
    if (fcntl(fds[i], F_SETFD, FD_CLOEXEC) < 0) {
      int saved = errno;
      for (int j = 0; j < count; j++) close(fds[j]);
      errno = saved; return fail(env, "received FD CLOEXEC");
    }
  }
  if (msg.msg_flags & (MSG_TRUNC | MSG_CTRUNC)) {
    for (int i = 0; i < count; i++) close(fds[i]);
    errno = EMSGSIZE; return fail(env, "recvmsg truncated");
  }
  napi_value result, body, list;
  NAPI(napi_create_object(env, &result));
  NAPI(napi_create_string_utf8(env, text, (size_t)n, &body));
  NAPI(napi_create_array_with_length(env, (size_t)count, &list));
  for (int i = 0; i < count; i++) napi_set_element(env, list, (uint32_t)i, integer(env, fds[i]));
  prop(env, result, "text", body); prop(env, result, "fds", list);
  return result;
}
static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; uint32_t count;
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  NAPI(napi_get_array_length(env, args[0], &count));
  if (count < 4 || count > 64) { errno = EINVAL; return fail(env, "spawn argv"); }
  char *argv[65] = {0};
  for (uint32_t i = 0; i < count; i++) {
    napi_value v; napi_get_element(env, args[0], i, &v); argv[i] = string(env, v);
    if (!argv[i]) { for (uint32_t j = 0; j < i; j++) free(argv[j]); errno = ENOMEM; return fail(env, "spawn argv"); }
  }
  int master = -1, slave = -1, ctl[2] = {-1, -1};
  struct winsize size = { .ws_row = 24, .ws_col = 80 };
  if (openpty(&master, &slave, NULL, NULL, &size) ||
      socket_pair(SOCK_STREAM, ctl, 0)) goto failed;
  fcntl(master, F_SETFD, FD_CLOEXEC);
  fcntl(master, F_SETFL, O_NONBLOCK);
  fcntl(ctl[0], F_SETFL, O_NONBLOCK);
  long fd_limit = sysconf(_SC_OPEN_MAX);
  if (fd_limit < 4 || fd_limit > INT_MAX) { errno = EINVAL; goto failed; }
  pid_t pid = fork();
  if (pid == 0) {
    /* Only async-signal-safe operations between a multithreaded Node fork and exec. */
    if (dup2(slave, 0) < 0 || dup2(slave, 1) < 0 || dup2(slave, 2) < 0 || dup2(ctl[1], 3) < 0) _exit(125);
#ifdef __linux__
    if (syscall(SYS_close_range, 4U, UINT_MAX, 0) < 0)
#endif
      for (int fd = 4; fd < fd_limit; fd++) close(fd);
    execv(argv[0], argv);
    _exit(127);
  }
  if (pid < 0) goto failed;
  close(slave); close(ctl[1]);
  for (uint32_t i = 0; i < count; i++) free(argv[i]);
  napi_value result; NAPI(napi_create_object(env, &result));
  prop(env, result, "master", integer(env, master));
  prop(env, result, "control", integer(env, ctl[0]));
  prop(env, result, "guardian", integer(env, pid));
  return result;
failed: {
  int saved = errno;
  if (master >= 0) close(master);
  if (slave >= 0) close(slave);
  if (ctl[0] >= 0) close(ctl[0]);
  if (ctl[1] >= 0) close(ctl[1]);
  for (uint32_t i = 0; i < count; i++) free(argv[i]);
  errno = saved; return fail(env, "spawn");
}}
static napi_value read_fd(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  char buffer[MAX_PACKET]; ssize_t n = read(number(env, args[0]), buffer, sizeof(buffer));
  if (n < 0 && (errno == EAGAIN || errno == EINTR)) return nothing(env);
  if (n < 0 && errno != EIO) return fail(env, "read");
  napi_value result;
  NAPI(napi_create_buffer_copy(env, n > 0 ? (size_t)n : 0, buffer, NULL, &result));
  return result;
}
static napi_value write_fd(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2]; void *data; size_t length;
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  NAPI(napi_get_buffer_info(env, args[1], &data, &length));
  ssize_t n = write(number(env, args[0]), data, length);
  if (n < 0 && (errno == EAGAIN || errno == EINTR)) return integer(env, 0);
  if (n < 0) return fail(env, "write");
  return integer(env, (int)n);
}
static napi_value resize(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  struct winsize size = { .ws_row = (unsigned short)number(env, args[1]), .ws_col = (unsigned short)number(env, args[2]) };
  if (ioctl(number(env, args[0]), TIOCSWINSZ, &size) < 0) return fail(env, "resize");
  return nothing(env);
}
static napi_value wait_pid(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; int status;
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  pid_t pid = waitpid(number(env, args[0]), &status, WNOHANG);
  if (pid == 0 || (pid < 0 && errno == EINTR)) return nothing(env);
  if (pid < 0 && errno != ECHILD) return fail(env, "waitpid");
  napi_value result; NAPI(napi_create_object(env, &result));
  prop(env, result, "pid", integer(env, pid));
  if (pid > 0) {
    prop(env, result, "raw", integer(env, status));
    prop(env, result, "code", integer(env, WIFEXITED(status) ? WEXITSTATUS(status) : -1));
    prop(env, result, "signal", integer(env, WIFSIGNALED(status) ? WTERMSIG(status) : 0));
  }
  return result;
}
static napi_value close_fd(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  if (close(number(env, args[0])) < 0) return fail(env, "close");
  return nothing(env);
}
static napi_value subreaper(napi_env env, napi_callback_info info) {
  (void)info;
#ifdef __linux__
  if (prctl(PR_SET_CHILD_SUBREAPER, 1) < 0) return fail(env, "subreaper");
#endif
  return nothing(env);
}
static napi_value identity(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  int pid = number(env, args[0]), ppid; char start[128];
#ifdef __APPLE__
  struct proc_bsdinfo bsd;
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, sizeof(bsd)) != sizeof(bsd)) return fail(env, "proc_pidinfo");
  ppid = (int)bsd.pbi_ppid;
  snprintf(start, sizeof(start), "%llu:%llu", (unsigned long long)bsd.pbi_start_tvsec, (unsigned long long)bsd.pbi_start_tvusec);
#else
  char path[64], buffer[4096]; snprintf(path, sizeof(path), "/proc/%d/stat", pid);
  FILE *fp = fopen(path, "r");
  if (!fp) return fail(env, "identity");
  if (!fgets(buffer, sizeof(buffer), fp)) { fclose(fp); errno = EIO; return fail(env, "stat"); }
  fclose(fp);
  char *fields = strrchr(buffer, ')');
  if (!fields) { errno = EINVAL; return fail(env, "stat fields"); }
  char *save, *token = strtok_r(fields + 2, " ", &save); int field = 0; ppid = -1; start[0] = 0;
  while (token) {
    if (field == 1) ppid = atoi(token);
    if (field == 19) { snprintf(start, sizeof(start), "%s", token); break; }
    field++; token = strtok_r(NULL, " ", &save);
  }
#endif
  napi_value result, birth; NAPI(napi_create_object(env, &result));
  NAPI(napi_create_string_utf8(env, start, NAPI_AUTO_LENGTH, &birth));
  prop(env, result, "ppid", integer(env, ppid)); prop(env, result, "start", birth);
  return result;
}
static napi_value master_leaks(napi_env env, napi_callback_info info) {
  (void)info; int count = 0;
  /* Bounded fixture check; spawn itself scrubs the complete FD range. */
  for (int fd = 3; fd < 4096; fd++) {
    struct stat st;
    if (fstat(fd, &st) == 0 && S_ISCHR(st.st_mode) && ptsname(fd) != NULL) count++;
  }
  return integer(env, count);
}
static napi_value parent_watch(napi_env env, napi_callback_info info) {
  (void)info;
#ifdef __APPLE__
  int fd = kqueue();
  if (fd < 0) return fail(env, "kqueue");
  fcntl(fd, F_SETFD, FD_CLOEXEC);
  return integer(env, fd);
#else
  return integer(env, -1);
#endif
}
static napi_value watch_pid(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
#ifdef __APPLE__
  struct kevent event; EV_SET(&event, number(env, args[1]), EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  if (kevent(number(env, args[0]), &event, 1, NULL, 0, NULL) < 0) return fail(env, "watch NOTE_EXIT");
#endif
  return nothing(env);
}
static napi_value poll_watch(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
#ifdef __APPLE__
  struct kevent event; struct timespec zero = {0};
  int n = kevent(number(env, args[0]), NULL, 0, &event, 1, &zero);
  if (n < 0) return fail(env, "poll NOTE_EXIT");
  if (n > 0 && (event.fflags & NOTE_EXIT)) return integer(env, (int)event.ident);
#endif
  return nothing(env);
}
NAPI_MODULE_INIT() {
  napi_property_descriptor methods[] = {
    {"pair", NULL, pair, NULL, NULL, NULL, napi_default, NULL},
    {"send", NULL, send_packet, NULL, NULL, NULL, napi_default, NULL},
    {"receive", NULL, receive_packet, NULL, NULL, NULL, napi_default, NULL},
    {"start", NULL, start, NULL, NULL, NULL, napi_default, NULL},
    {"read", NULL, read_fd, NULL, NULL, NULL, napi_default, NULL},
    {"write", NULL, write_fd, NULL, NULL, NULL, napi_default, NULL},
    {"resize", NULL, resize, NULL, NULL, NULL, napi_default, NULL},
    {"wait", NULL, wait_pid, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_fd, NULL, NULL, NULL, napi_default, NULL},
    {"subreaper", NULL, subreaper, NULL, NULL, NULL, napi_default, NULL},
    {"identity", NULL, identity, NULL, NULL, NULL, napi_default, NULL},
    {"masterLeaks", NULL, master_leaks, NULL, NULL, NULL, napi_default, NULL},
    {"parentWatch", NULL, parent_watch, NULL, NULL, NULL, napi_default, NULL},
    {"watchPid", NULL, watch_pid, NULL, NULL, NULL, napi_default, NULL},
    {"pollWatch", NULL, poll_watch, NULL, NULL, NULL, napi_default, NULL},
  };
  NAPI(napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods));
  return exports;
}
#endif
