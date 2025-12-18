/**
 * WASI Preview 1 type definitions
 *
 * These types define all the constants and structures used by the
 * wasi_snapshot_preview1 API.
 *
 * @see https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md
 * @packageDocumentation
 */

// =============================================================================
// Error Codes (errno)
// =============================================================================

/**
 * WASI error codes returned by all WASI functions.
 * These match POSIX errno values.
 */
export const Errno = {
  /** No error occurred. System call completed successfully. */
  SUCCESS: 0,
  /** Argument list too long. */
  E2BIG: 1,
  /** Permission denied. */
  EACCES: 2,
  /** Address in use. */
  EADDRINUSE: 3,
  /** Address not available. */
  EADDRNOTAVAIL: 4,
  /** Address family not supported. */
  EAFNOSUPPORT: 5,
  /** Resource unavailable, or operation would block. */
  EAGAIN: 6,
  /** Connection already in progress. */
  EALREADY: 7,
  /** Bad file descriptor. */
  EBADF: 8,
  /** Bad message. */
  EBADMSG: 9,
  /** Device or resource busy. */
  EBUSY: 10,
  /** Operation canceled. */
  ECANCELED: 11,
  /** No child processes. */
  ECHILD: 12,
  /** Connection aborted. */
  ECONNABORTED: 13,
  /** Connection refused. */
  ECONNREFUSED: 14,
  /** Connection reset. */
  ECONNRESET: 15,
  /** Resource deadlock would occur. */
  EDEADLK: 16,
  /** Destination address required. */
  EDESTADDRREQ: 17,
  /** Mathematics argument out of domain of function. */
  EDOM: 18,
  /** Reserved. */
  EDQUOT: 19,
  /** File exists. */
  EEXIST: 20,
  /** Bad address. */
  EFAULT: 21,
  /** File too large. */
  EFBIG: 22,
  /** Host is unreachable. */
  EHOSTUNREACH: 23,
  /** Identifier removed. */
  EIDRM: 24,
  /** Illegal byte sequence. */
  EILSEQ: 25,
  /** Operation in progress. */
  EINPROGRESS: 26,
  /** Interrupted function. */
  EINTR: 27,
  /** Invalid argument. */
  EINVAL: 28,
  /** I/O error. */
  EIO: 29,
  /** Socket is connected. */
  EISCONN: 30,
  /** Is a directory. */
  EISDIR: 31,
  /** Too many levels of symbolic links. */
  ELOOP: 32,
  /** File descriptor value too large. */
  EMFILE: 33,
  /** Too many links. */
  EMLINK: 34,
  /** Message too large. */
  EMSGSIZE: 35,
  /** Reserved. */
  EMULTIHOP: 36,
  /** Filename too long. */
  ENAMETOOLONG: 37,
  /** Network is down. */
  ENETDOWN: 38,
  /** Connection aborted by network. */
  ENETRESET: 39,
  /** Network unreachable. */
  ENETUNREACH: 40,
  /** Too many files open in system. */
  ENFILE: 41,
  /** No buffer space available. */
  ENOBUFS: 42,
  /** No such device. */
  ENODEV: 43,
  /** No such file or directory. */
  ENOENT: 44,
  /** Executable file format error. */
  ENOEXEC: 45,
  /** No locks available. */
  ENOLCK: 46,
  /** Reserved. */
  ENOLINK: 47,
  /** Not enough space. */
  ENOMEM: 48,
  /** No message of the desired type. */
  ENOMSG: 49,
  /** Protocol not available. */
  ENOPROTOOPT: 50,
  /** No space left on device. */
  ENOSPC: 51,
  /** Function not supported. */
  ENOSYS: 52,
  /** The socket is not connected. */
  ENOTCONN: 53,
  /** Not a directory or a symbolic link to a directory. */
  ENOTDIR: 54,
  /** Directory not empty. */
  ENOTEMPTY: 55,
  /** State not recoverable. */
  ENOTRECOVERABLE: 56,
  /** Not a socket. */
  ENOTSOCK: 57,
  /** Not supported, or operation not supported on socket. */
  ENOTSUP: 58,
  /** Inappropriate I/O control operation. */
  ENOTTY: 59,
  /** No such device or address. */
  ENXIO: 60,
  /** Value too large to be stored in data type. */
  EOVERFLOW: 61,
  /** Previous owner died. */
  EOWNERDEAD: 62,
  /** Operation not permitted. */
  EPERM: 63,
  /** Broken pipe. */
  EPIPE: 64,
  /** Protocol error. */
  EPROTO: 65,
  /** Protocol not supported. */
  EPROTONOSUPPORT: 66,
  /** Protocol wrong type for socket. */
  EPROTOTYPE: 67,
  /** Result too large. */
  ERANGE: 68,
  /** Read-only file system. */
  EROFS: 69,
  /** Invalid seek. */
  ESPIPE: 70,
  /** No such process. */
  ESRCH: 71,
  /** Reserved. */
  ESTALE: 72,
  /** Connection timed out. */
  ETIMEDOUT: 73,
  /** Text file busy. */
  ETXTBSY: 74,
  /** Cross-device link. */
  EXDEV: 75,
  /** Extension: Capabilities insufficient. */
  ENOTCAPABLE: 76,
} as const

export type Errno = (typeof Errno)[keyof typeof Errno]

// =============================================================================
// Clock IDs
// =============================================================================

/**
 * Identifiers for clocks.
 */
export const ClockId = {
  /** The clock measuring real time. */
  REALTIME: 0,
  /** The store-wide monotonic clock. */
  MONOTONIC: 1,
  /** The CPU-time clock associated with the current process. */
  PROCESS_CPUTIME_ID: 2,
  /** The CPU-time clock associated with the current thread. */
  THREAD_CPUTIME_ID: 3,
} as const

export type ClockId = (typeof ClockId)[keyof typeof ClockId]

// =============================================================================
// File Descriptor Flags
// =============================================================================

/**
 * File descriptor flags.
 */
export const FdFlags = {
  /** Append mode: Data written to the file is always appended to the file's end. */
  APPEND: 1 << 0,
  /** Write according to synchronized I/O data integrity completion. */
  DSYNC: 1 << 1,
  /** Non-blocking mode. */
  NONBLOCK: 1 << 2,
  /** Synchronized read I/O operations. */
  RSYNC: 1 << 3,
  /** Write according to synchronized I/O file integrity completion. */
  SYNC: 1 << 4,
} as const

export type FdFlags = number

// =============================================================================
// File Types
// =============================================================================

/**
 * The type of a file descriptor or file.
 */
export const FileType = {
  /** The type of the file descriptor or file is unknown or is different from any of the other types specified. */
  UNKNOWN: 0,
  /** The file descriptor or file refers to a block device inode. */
  BLOCK_DEVICE: 1,
  /** The file descriptor or file refers to a character device inode. */
  CHARACTER_DEVICE: 2,
  /** The file descriptor or file refers to a directory inode. */
  DIRECTORY: 3,
  /** The file descriptor or file refers to a regular file inode. */
  REGULAR_FILE: 4,
  /** The file descriptor or file refers to a datagram socket. */
  SOCKET_DGRAM: 5,
  /** The file descriptor or file refers to a byte-stream socket. */
  SOCKET_STREAM: 6,
  /** The file refers to a symbolic link inode. */
  SYMBOLIC_LINK: 7,
} as const

export type FileType = (typeof FileType)[keyof typeof FileType]

// =============================================================================
// Rights
// =============================================================================

/**
 * File descriptor rights, determining which actions may be performed.
 */
export const Rights = {
  /** The right to invoke fd_datasync. */
  FD_DATASYNC: 1n << 0n,
  /** The right to invoke fd_read and sock_recv. */
  FD_READ: 1n << 1n,
  /** The right to invoke fd_seek. */
  FD_SEEK: 1n << 2n,
  /** The right to invoke fd_fdstat_set_flags. */
  FD_FDSTAT_SET_FLAGS: 1n << 3n,
  /** The right to invoke fd_sync. */
  FD_SYNC: 1n << 4n,
  /** The right to invoke fd_tell. */
  FD_TELL: 1n << 5n,
  /** The right to invoke fd_write and sock_send. */
  FD_WRITE: 1n << 6n,
  /** The right to invoke fd_advise. */
  FD_ADVISE: 1n << 7n,
  /** The right to invoke fd_allocate. */
  FD_ALLOCATE: 1n << 8n,
  /** The right to invoke path_create_directory. */
  PATH_CREATE_DIRECTORY: 1n << 9n,
  /** The right to invoke path_create_file. */
  PATH_CREATE_FILE: 1n << 10n,
  /** The right to invoke path_link with the file descriptor as the source directory. */
  PATH_LINK_SOURCE: 1n << 11n,
  /** The right to invoke path_link with the file descriptor as the target directory. */
  PATH_LINK_TARGET: 1n << 12n,
  /** The right to invoke path_open. */
  PATH_OPEN: 1n << 13n,
  /** The right to invoke fd_readdir. */
  FD_READDIR: 1n << 14n,
  /** The right to invoke path_readlink. */
  PATH_READLINK: 1n << 15n,
  /** The right to invoke path_rename with the file descriptor as the source directory. */
  PATH_RENAME_SOURCE: 1n << 16n,
  /** The right to invoke path_rename with the file descriptor as the target directory. */
  PATH_RENAME_TARGET: 1n << 17n,
  /** The right to invoke path_filestat_get. */
  PATH_FILESTAT_GET: 1n << 18n,
  /** The right to change a file's size. */
  PATH_FILESTAT_SET_SIZE: 1n << 19n,
  /** The right to invoke path_filestat_set_times. */
  PATH_FILESTAT_SET_TIMES: 1n << 20n,
  /** The right to invoke fd_filestat_get. */
  FD_FILESTAT_GET: 1n << 21n,
  /** The right to invoke fd_filestat_set_size. */
  FD_FILESTAT_SET_SIZE: 1n << 22n,
  /** The right to invoke fd_filestat_set_times. */
  FD_FILESTAT_SET_TIMES: 1n << 23n,
  /** The right to invoke path_symlink. */
  PATH_SYMLINK: 1n << 24n,
  /** The right to invoke path_remove_directory. */
  PATH_REMOVE_DIRECTORY: 1n << 25n,
  /** The right to invoke path_unlink_file. */
  PATH_UNLINK_FILE: 1n << 26n,
  /** If path_open is set, the right to invoke poll_oneoff. */
  POLL_FD_READWRITE: 1n << 27n,
  /** The right to invoke sock_shutdown. */
  SOCK_SHUTDOWN: 1n << 28n,
  /** The right to invoke sock_accept. */
  SOCK_ACCEPT: 1n << 29n,
} as const

export type Rights = bigint

/** All rights combined. */
export const ALL_RIGHTS: Rights = Object.values(Rights).reduce((a, b) => a | b, 0n)

/** Rights for a directory file descriptor. */
export const DIRECTORY_RIGHTS: Rights =
  Rights.FD_FDSTAT_SET_FLAGS |
  Rights.FD_SYNC |
  Rights.FD_ADVISE |
  Rights.PATH_CREATE_DIRECTORY |
  Rights.PATH_CREATE_FILE |
  Rights.PATH_LINK_SOURCE |
  Rights.PATH_LINK_TARGET |
  Rights.PATH_OPEN |
  Rights.FD_READDIR |
  Rights.PATH_READLINK |
  Rights.PATH_RENAME_SOURCE |
  Rights.PATH_RENAME_TARGET |
  Rights.PATH_FILESTAT_GET |
  Rights.PATH_FILESTAT_SET_SIZE |
  Rights.PATH_FILESTAT_SET_TIMES |
  Rights.FD_FILESTAT_GET |
  Rights.FD_FILESTAT_SET_TIMES |
  Rights.PATH_SYMLINK |
  Rights.PATH_REMOVE_DIRECTORY |
  Rights.PATH_UNLINK_FILE

/** Rights for a regular file descriptor. */
export const FILE_RIGHTS: Rights =
  Rights.FD_DATASYNC |
  Rights.FD_READ |
  Rights.FD_SEEK |
  Rights.FD_FDSTAT_SET_FLAGS |
  Rights.FD_SYNC |
  Rights.FD_TELL |
  Rights.FD_WRITE |
  Rights.FD_ADVISE |
  Rights.FD_ALLOCATE |
  Rights.FD_FILESTAT_GET |
  Rights.FD_FILESTAT_SET_SIZE |
  Rights.FD_FILESTAT_SET_TIMES |
  Rights.POLL_FD_READWRITE

/** Rights for stdin. */
export const STDIN_RIGHTS: Rights = Rights.FD_READ | Rights.POLL_FD_READWRITE

/** Rights for stdout/stderr. */
export const STDOUT_RIGHTS: Rights = Rights.FD_WRITE | Rights.POLL_FD_READWRITE

// =============================================================================
// Whence (for seek)
// =============================================================================

/**
 * The position relative to which to set the offset of the file descriptor.
 */
export const Whence = {
  /** Seek relative to start-of-file. */
  SET: 0,
  /** Seek relative to current position. */
  CUR: 1,
  /** Seek relative to end-of-file. */
  END: 2,
} as const

export type Whence = (typeof Whence)[keyof typeof Whence]

// =============================================================================
// Lookup Flags
// =============================================================================

/**
 * Flags determining the method of how paths are resolved.
 */
export const LookupFlags = {
  /** As long as the resolved path corresponds to a symbolic link, it is expanded. */
  SYMLINK_FOLLOW: 1 << 0,
} as const

export type LookupFlags = number

// =============================================================================
// Open Flags
// =============================================================================

/**
 * Open flags used by path_open.
 */
export const OFlags = {
  /** Create file if it does not exist. */
  CREAT: 1 << 0,
  /** Fail if not a directory. */
  DIRECTORY: 1 << 1,
  /** Fail if file already exists. */
  EXCL: 1 << 2,
  /** Truncate file to size 0. */
  TRUNC: 1 << 3,
} as const

export type OFlags = number

// =============================================================================
// Prestat
// =============================================================================

/**
 * Type of a prestat.
 */
export const PrestatType = {
  /** A pre-opened directory. */
  DIR: 0,
} as const

export type PrestatType = (typeof PrestatType)[keyof typeof PrestatType]

// =============================================================================
// Advice
// =============================================================================

/**
 * File or memory access pattern advisory information.
 */
export const Advice = {
  /** The application has no advice to give on its behavior with respect to the specified data. */
  NORMAL: 0,
  /** The application expects to access the specified data sequentially from lower offsets to higher offsets. */
  SEQUENTIAL: 1,
  /** The application expects to access the specified data in a random order. */
  RANDOM: 2,
  /** The application expects to access the specified data in the near future. */
  WILLNEED: 3,
  /** The application expects that it will not access the specified data in the near future. */
  DONTNEED: 4,
  /** The application expects to access the specified data once and then not reuse it thereafter. */
  NOREUSE: 5,
} as const

export type Advice = (typeof Advice)[keyof typeof Advice]

// =============================================================================
// Filestat Flags
// =============================================================================

/**
 * Which file time attributes to adjust.
 */
export const FstFlags = {
  /** Adjust the last data access timestamp to the value stored in filestat::atim. */
  ATIM: 1 << 0,
  /** Adjust the last data access timestamp to the time of clock clockid::realtime. */
  ATIM_NOW: 1 << 1,
  /** Adjust the last data modification timestamp to the value stored in filestat::mtim. */
  MTIM: 1 << 2,
  /** Adjust the last data modification timestamp to the time of clock clockid::realtime. */
  MTIM_NOW: 1 << 3,
} as const

export type FstFlags = number

// =============================================================================
// Event Types (for poll)
// =============================================================================

/**
 * Type of a subscription to an event or its occurrence.
 */
export const EventType = {
  /** The time value of clock has reached timestamp. */
  CLOCK: 0,
  /** File descriptor has data available for reading. */
  FD_READ: 1,
  /** File descriptor has capacity available for writing. */
  FD_WRITE: 2,
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

/**
 * The state of the file descriptor subscribed to with eventtype::fd_read or eventtype::fd_write.
 */
export const EventRwFlags = {
  /** The peer of this socket has closed or disconnected. */
  FD_READWRITE_HANGUP: 1 << 0,
} as const

export type EventRwFlags = number

/**
 * Flags determining how to interpret the timestamp provided in subscription_clock::timeout.
 */
export const SubclockFlags = {
  /** If set, treat timeout as an absolute timestamp. */
  SUBSCRIPTION_CLOCK_ABSTIME: 1 << 0,
} as const

export type SubclockFlags = number

// =============================================================================
// Signal
// =============================================================================

/**
 * Signal condition.
 */
export const Signal = {
  /** No signal. */
  NONE: 0,
  /** Hangup. */
  HUP: 1,
  /** Terminate interrupt signal. */
  INT: 2,
  /** Terminal quit signal. */
  QUIT: 3,
  /** Illegal instruction. */
  ILL: 4,
  /** Trace/breakpoint trap. */
  TRAP: 5,
  /** Process abort signal. */
  ABRT: 6,
  /** Access to an undefined portion of a memory object. */
  BUS: 7,
  /** Erroneous arithmetic operation. */
  FPE: 8,
  /** Kill (cannot be caught or ignored). */
  KILL: 9,
  /** User-defined signal 1. */
  USR1: 10,
  /** Invalid memory reference. */
  SEGV: 11,
  /** User-defined signal 2. */
  USR2: 12,
  /** Write on a pipe with no one to read it. */
  PIPE: 13,
  /** Alarm clock. */
  ALRM: 14,
  /** Termination signal. */
  TERM: 15,
  /** Child process terminated, stopped, or continued. */
  CHLD: 16,
  /** Continue executing, if stopped. */
  CONT: 17,
  /** Stop executing (cannot be caught or ignored). */
  STOP: 18,
  /** Terminal stop signal. */
  TSTP: 19,
  /** Background process attempting read. */
  TTIN: 20,
  /** Background process attempting write. */
  TTOU: 21,
  /** High bandwidth data is available at a socket. */
  URG: 22,
  /** CPU time limit exceeded. */
  XCPU: 23,
  /** File size limit exceeded. */
  XFSZ: 24,
  /** Virtual timer expired. */
  VTALRM: 25,
  /** Profiling timer expired. */
  PROF: 26,
  /** Window changed. */
  WINCH: 27,
  /** I/O possible. */
  POLL: 28,
  /** Power failure. */
  PWR: 29,
  /** Bad system call. */
  SYS: 30,
} as const

export type Signal = (typeof Signal)[keyof typeof Signal]

// =============================================================================
// Socket Types
// =============================================================================

/**
 * Flags provided to sock_recv.
 */
export const RiFlags = {
  /** Returns the message without removing it from the socket's receive queue. */
  RECV_PEEK: 1 << 0,
  /** On byte-stream sockets, block until the full amount of data can be returned. */
  RECV_WAITALL: 1 << 1,
} as const

export type RiFlags = number

/**
 * Flags returned by sock_recv.
 */
export const RoFlags = {
  /** Returned by sock_recv: Message data has been truncated. */
  RECV_DATA_TRUNCATED: 1 << 0,
} as const

export type RoFlags = number

/**
 * Flags provided to sock_send.
 */
export const SiFlags = {
  // Currently none defined
} as const

export type SiFlags = number

/**
 * Which channels on a socket to shut down.
 */
export const SdFlags = {
  /** Disables further receive operations. */
  RD: 1 << 0,
  /** Disables further send operations. */
  WR: 1 << 1,
} as const

export type SdFlags = number

// =============================================================================
// Structure Sizes (for memory layout)
// =============================================================================

/** Size of iovec structure: buf (i32) + len (i32) */
export const IOVEC_SIZE = 8

/** Size of ciovec structure: buf (i32) + len (i32) */
export const CIOVEC_SIZE = 8

/** Size of filestat structure */
export const FILESTAT_SIZE = 64

/** Size of fdstat structure */
export const FDSTAT_SIZE = 24

/** Size of prestat structure */
export const PRESTAT_SIZE = 8

/** Size of dirent structure (without name) */
export const DIRENT_SIZE = 24

/** Size of event structure */
export const EVENT_SIZE = 32

/** Size of subscription structure */
export const SUBSCRIPTION_SIZE = 48
