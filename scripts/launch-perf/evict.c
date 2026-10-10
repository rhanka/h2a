#define _POSIX_C_SOURCE 200809L
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    int fd = open(argv[i], O_RDWR);
    if (fd < 0 || fsync(fd) || posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED)) {
      perror(argv[i]); return 1;
    }
    close(fd);
  }
  return 0;
}
