# java.io

TypeScript library for interacting with serialized Java objects.

> [!WARNING]
> ***HIGHLY WORK IN PROGRESS. DOES NOT FUNCTION COMPLETELY.***

## Why?

Some Java applications store data as [serialized objects](https://docs.oracle.com/en/java/javase/11/docs/specs/serialization). These objects use a standardized [protocol](https://docs.oracle.com/javase/6/docs/platform/serialization/spec/protocol.html) to enable them to be deserialized at runtime and turned back into usable classes. This is similar to the encoding done by Python in the [`pickle`](https://docs.python.org/3/library/pickle.html) module.

This library provides methods for reading these serialized objects into data usable in JavaScript applications.

The main purpose for this at Pretendo Network is to read the data without standard [Charles Proxy](https://charlesproxy.com) dumps outside of Charles.

Some existing attempts at this have been made, but all have some sort of issues making them unusable in their current forms:

- https://github.com/NickstaDB/SerializationDumper
  - Is written in Java itself, making it difficult to integrate into a JavaScript application
  - Is designed to dump data to `stdout`, as debug data. It does not produce any easily parsable data
- https://github.com/node-modules/java.io (this libraries namesake)
  - Seems largely abandoned
    - There has been no activity in over 6 years
    - 4 open issues with no activity past 2017
    - 4 open pull requests with no activity. 2 of them add missing features (2015/2016), 1 fixes a security issue (2023), and 1 adds TypeScript types (2020)
  - Has issues parsing Charles dumps specifically (likely due to the aforementioned missing features)
  - Lacks types
  - Lacks support for reading objects written using `writeExternal` (protocols 1 and 2) and `writeObject` (protocol 2), both of which Charles uses
- Charles CLI tool
  - Is a CLI tool, making it difficult to cleanly integrate with
  - Only works on files, not data, resulting in hacky temporary files everywhere which need cleanup
  - Only works on systems which have Charles installed. Charles is paid software, so this is not always going to be present
  - Converting dumps with the CLI tool often loses data. Namely WebSocket packets become unusable

This library aims to replace much of what https://github.com/node-modules/java.io provided in terms of reading, with the addition of types and more class support. Writing serialized objects is not a goal at this time.