#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <fts.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  FTS *tree = fts_open(argv + 1, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
  if (!tree) { perror("fts_open"); return 1; }
  FTSENT *entry;
  size_t files = 0;
  while ((entry = fts_read(tree))) {
    if (entry->fts_info == FTS_ERR || entry->fts_info == FTS_DNR) { perror(entry->fts_path); fts_close(tree); return 1; }
    if (entry->fts_info != FTS_F) continue;
    int fd = open(entry->fts_path, O_RDONLY | O_NOFOLLOW);
    if (fd < 0 || fsync(fd) || posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED)) {
      perror(entry->fts_path); if (fd >= 0) close(fd); fts_close(tree); return 1;
    }
    close(fd); files++;
  }
  if (fts_close(tree)) return 1;
  printf("{\"operation\":\"fsync-and-fadvise-owned-inactive-fixtures\",\"files\":%zu}\n", files);
  return 0;
}
