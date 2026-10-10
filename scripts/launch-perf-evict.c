// Evict only explicitly named synthetic files; no global cache drop.
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    int fd = open(argv[i], O_RDONLY);
    if (fd < 0) { perror(argv[i]); return 1; }
    if (fsync(fd) || posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED)) return 2;
    close(fd);
  }
  return 0;
}
