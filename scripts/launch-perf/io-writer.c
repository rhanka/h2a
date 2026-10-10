// Bounded disk footprint and userspace memory; every block reaches fsync.
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <time.h>
static volatile sig_atomic_t stopped = 0;
static void stop(int signal) { (void)signal; stopped = 1; }
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int fd = open(argv[1], O_CREAT|O_RDWR|O_CLOEXEC, 0600);
  if (fd < 0) { perror("open"); return 3; }
  const size_t block = 1024 * 1024;
  void *buffer = malloc(block); memset(buffer, 0x5a, block);
  signal(SIGTERM,stop); signal(SIGINT,stop);
  unsigned long long bytes = 0; unsigned n = 0;
  while (!stopped) {
    if (pwrite(fd,buffer,block,(off_t)(n%128)*block) != (ssize_t)block || fsync(fd)) { perror("write/fsync"); close(fd); return 4; }
    bytes += block; n++;
    if (n%64 == 0) fprintf(stderr,"bytes=%llu fsync=%u\n",bytes,n);
  }
  fprintf(stderr,"final bytes=%llu fsync=%u\n",bytes,n);
  free(buffer); close(fd); return 0;
}
