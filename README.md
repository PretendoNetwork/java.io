# java.io

TypeScript library for interacting with serialized Java objects.

## Why?

Some Java applications store data as [serialized objects](https://docs.oracle.com/en/java/javase/11/docs/specs/serialization). These objects use a standardized [protocol](https://docs.oracle.com/javase/6/docs/platform/serialization/spec/protocol.html) to enable them to be deserialized at runtime and turned back into usable classes. This is similar to the encoding done by Python in the [`pickle`](https://docs.python.org/3/library/pickle.html) module.

This library provides methods for reading these serialized objects into data usable in JavaScript applications.

The main purpose for this at Pretendo Network is to read the data within standard [Charles Proxy](https://charlesproxy.com) dumps outside of Charles.

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
  - Requires defining custom classes for parsing all object types not already supported
- Charles CLI tool
  - Is a CLI tool, making it difficult to cleanly integrate with
  - Only works on files, not data, resulting in hacky temporary files everywhere which need cleanup
  - Only works on systems which have Charles installed. Charles is paid software, so this is not always going to be present
  - Converting dumps with the CLI tool often loses data. Namely WebSocket packets become unusable
  - Only works on Charles dump files, not on any Java serialized data

This library aims to replace much of what https://github.com/node-modules/java.io provided in terms of reading, with the addition of types and more class support. Writing serialized objects is not a goal at this time.

## Usage

```bash
npm i @pretendonetwork/java.io
```

### Example: Reading `chls` files:

```ts
import fs from 'node:fs';
import { ObjectInputStream } from '@pretendonetwork/java.io';
import ByteStream from './byte-stream'; // * Provide this yourself.
import type { JavaObject, JavaClassDesc } from '@pretendonetwork/java.io';

const chlsBuffer = fs.readFileSync('./wiiu-proxy.chls');
const stream = new ByteStream(chlsBuffer);
const ois = new ObjectInputStream(stream);
const objects = ois.readAll(); // * Read all the objects in the file until no more data is left.
const session = objects[0]; // * Charles packet dumps will always only have one object, the session.
const transactions = getTransactions(session).sort((a, b) => {
	// * Since transactions are stored out of order, need to reorder them.
	const startTime1 = a.description!.classData.values.startTime.description.classData.annotation[0].data.readBigInt64BE();
	const startTime2 = b.description!.classData.values.startTime.description.classData.annotation[0].data.readBigInt64BE();

	return Number(startTime1) - Number(startTime2);
});

// * Print the full URL for each proxied request.
for (const transaction of transactions) {
	if (!transaction.description) {
		continue; // * This will never happen in this case.
	}

	const protocol = transaction.description.classData.values.protocol.value;
	const host = transaction.description.classData.values.host.value;

	if (transaction.description.classData.values.file) {
		const path = transaction.description.classData.values.file.value;

		console.log(`${protocol}://${host}${path}`);
	} else if (transaction.description.classData.values.exception) {
		console.log(`${protocol}://${host} FAILED`); // * Not all requests will successfully proxy.
	}
}

// * Extract all "com.xk72.charles.model.Transaction" objects from the session.
// * "com.xk72.charles.model.Transaction" is what stores the true request details.
function getTransactions(session: JavaObject) {
	const transactions: JavaObject[] = [];
	const modelNode = session.description!.info.superClass!; // * These will always exist in this case.
	const childrenArrayList = modelNode.classData.values.children.description;
	const hosts = childrenArrayList.classData.annotation.splice(1); // * Index 0 is the capacity of the array as a buffer.

	// * Charles "com.xk72.charles.model.ModelNode" classes store the minimal number of
	// * children possible. The children of "com.xk72.charles.model.Session" are all
	// * "com.xk72.charles.model.Host" classes. If a new host is being requested then
	// * a new "com.xk72.charles.model.Host" class instance is created. Otherwise an
	// * existing instance is used. This means even if 100 requests were made, but only
	// * to the same 2 hosts, only 2 "com.xk72.charles.model.Host" objects will exist here.
	// * This also means request data is stored wildly out of order.
	for (const host of  hosts) {
		const path = host.description.info.superClass; // * "com.xk72.charles.model.Host" extends "com.xk72.charles.model.Path".
		transactions.push(...parsePath(path));
	}

	return transactions;
}

// * Recursively parse "com.xk72.charles.model.Path" objects to find their transactions.
function parsePath(path: JavaClassDesc) {
	// * A "com.xk72.charles.model.Path" object has 2 points of interest:
	// *   - It's path value
	// *   - It's children array
	// * Every "com.xk72.charles.model.Path" will hold one portion of the request path along with
	// * a "java.util.ArrayList" of child objects. Each child may be either a "com.xk72.charles.model.Path"
	// * object or a "com.xk72.charles.model.Transaction" object. If a child is a "com.xk72.charles.model.Transaction"
	// * object then that child holds the full request details for a given path. If a child is a
	// * "com.xk72.charles.model.Path" object then that child holds another portion of a different request path.
	// *
	// * For example if there was a request to both "https://account.nintendo.net/v1/api/people/@me/profile" and
	// * "https://account.nintendo.net/v1/api/people/@me" then the session structure would look like:
	// *
	// * com.xk72.charles.model.Session
	// * └── children
	// * 	└── com.xk72.charles.model.Host (extends com.xk72.charles.model.Path)
	// * 		└── children
	// * 			└── com.xk72.charles.model.Path
	// * 				├── value: "v1"
	// * 				└── children
	// * 					└── com.xk72.charles.model.Path
	// * 						├── value: "api"
	// * 						└── children
	// * 							└── com.xk72.charles.model.Path
	// * 								├── value: "people"
	// * 								└── children
	// * 									└── com.xk72.charles.model.Path
	// * 										├── value: "@me"
	// * 										└── children
	// * 											├── com.xk72.charles.model.Path
	// * 											│   ├── value: "profile"
	// * 											│   └── children
	// * 											│       └── com.xk72.charles.model.Transaction
	// * 											│           └── request data for "/v1/api/people/@me/profile"
	// * 											└── com.xk72.charles.model.Transaction
	// * 												└── request data for "/v1/api/people/@me"

	const transactions: JavaObject[] = [];
	const modelNode = path.info.superClass!; // * This will always exist in this case.
	const childrenArrayList = modelNode.classData.values.children.description;
	const children = childrenArrayList.classData.annotation.splice(1); // * Index 0 is the capacity of the array as a buffer.

	for (const child of children) {
		const className = child.description.className.value;

		if (className === 'com.xk72.charles.model.Path') {
			transactions.push(...parsePath(child.description));
		} else {
			transactions.push(child);
		}
	}

	return transactions;
}
```

## Types

### `InputStream`

Interface defining the structure of supported input types for `ObjectInputStream`. Expected to be a class capable of reading data from a data source and automatically managing the data sources offset.

```ts
interface InputStream {
	hasDataLeft(): boolean; // * Returns true if there is data remaining to be read, otherwise false
	pos(): number; // * The current data source offset
	peek(): number; // * Checks the byte at the current offset without increasing the offset
	skip(offset: number): void; // * Skips the given number of bytes
	read(len: number): Buffer; // * Reads the given number of bytes
	readBoolean(): boolean; // * Reads a boolean from the data source at the current offset
	readInt8(): number; // * Reads a signed 8-bit integer from the data source at the current offset
	readInt16BE(): number; // * Reads a signed 16-bit integer in big-endian format from the data source at the current offset
	readInt32BE(): number; // * Reads a signed 32-bit integer in big-endian format from the data source at the current offset
	readInt64BE(): bigint; // * Reads a signed 64-bit integer in big-endian format from the data source at the current offset
	readUInt8(): number; // * Reads an unsigned 8-bit integer from the data source at the current offset
	readUInt16BE(): number; // * Reads an unsigned 16-bit integer in big-endian format from the data source at the current offset
	readDoubleBE(): number; // * Reads an unsigned 64-bit double in big-endian format from the data source at the current offset
	readFloatBE(): number; // * Reads an unsigned 32-bit float in big-endian format from the data source at the current offset
};
```

## Classes

### `ObjectInputStream`

Port of the Java [`ObjectInputStream`](https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/io/ObjectInputStream.html). Most methods have the same implementation as the Java API. Used to deserialize Java object data.

> [!TIP]
> This is the only class intended for outside use. All others are only intended for use as types.

```ts
class ObjectInputStream {
	readBoolean(): boolean
	readByte(): number
	readChar(): string
	readDouble(): number
	readFloat(): number
	readInt(): number
	readLong(): bigint
	readShort(): number
	readUnsignedByte(): number
	readUnsignedShort(): number
	readUTF(): string
	readLongUTF(): string // * Not found in the Java API. Reads a string that has a 64-bit length value
	readAll(): JavaObject[] // * Not found in the Java API. Reads all objects in the stream
}
```

### `JavaObject`

Contains data for a serialized Java object.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaObject {
	description?: JavaClassDesc | null; // * Description of the class structure
	handle: number; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html#a8299

	clone(): JavaObject // * Clones the object into a new instance
}
```

### `JavaClassDesc`

Describes the structure of a serialized Java object/class.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaClassDesc {
	className: JavaString; // * Name of the class
	serialVersionUID: bigint; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/class.html#a5082
	handle: number; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html#a8299
	info: JavaClassDescInfo; // * Information about the classes fields and super-class
	classData: ClassData; // * Deserialized class data

	hasFlag(flag: number): boolean // * Checks if "JavaClassDesc.info.flags" has the given flag set
	clone(): JavaClassDesc // * Clones the object into a new instance
}
```

### `ClassData`

Contains the deserialized data of the object/class. Some data has known field names, and some do not. Both `values` and `annotation` may be populated. Up to the developer to handle the data found in `annotation`.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class ClassData {
	values: Record<string, any>; // * Deserialized class fields. Populated from the fields defined in "JavaClassDesc.info.fields"
	annotation: any[]; // * Any additional objects. Field names not present. Data is written from a Java class using either "writeObject" (version 1) or "writeExternal" (version 2). You must implement the handling of these fields

	clone(): ClassData // * Clones the object into a new instance
}
```

### `JavaClassDescInfo`

Contains some metadata about the class description. Flags can contain:

- `SC_WRITE_METHOD` = 0x01 (if `SC_SERIALIZABLE`)
- `SC_BLOCK_DATA` = 0x08 (if `SC_EXTERNALIZABLE`)
- `SC_SERIALIZABLE` = 0x02
- `SC_EXTERNALIZABLE` = 0x04
- `SC_ENUM` = 0x10

From https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html:

```
The flag SC_WRITE_METHOD is set if the Serializable class writing the stream had a writeObject method that may have written additional data to the stream. In this case a TC_ENDBLOCKDATA marker is always expected to terminate the data for that class.

The flag SC_BLOCKDATA is set if the Externalizable class is written into the stream using STREAM_PROTOCOL_2. By default, this is the protocol used to write Externalizable objects into the stream in JDK 1.2. JDK 1.1 writes STREAM_PROTOCOL_1.

The flag SC_SERIALIZABLE is set if the class that wrote the stream extended java.io.Serializable but not java.io.Externalizable, the class reading the stream must also extend java.io.Serializable and the default serialization mechanism is to be used.

The flag SC_EXTERNALIZABLE is set if the class that wrote the stream extended java.io.Externalizable, the class reading the data must also extend Externalizable and the data will be read using its writeExternal and readExternal methods.

The flag SC_ENUM is set if the class that wrote the stream was an enum type. The receiver's corresponding class must also be an enum type. Data for constants of the enum type will be written and read as described in Section 1.12, https://docs.oracle.com/javase/8/docs/platform/serialization/spec/serial-arch.html#a6469
```

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaClassDescInfo {
	flags: number; // * Flags which determine how the class data was written
	fields: JavaClassDescInfoField[]; // * Information about known field names/types
	annotation: any[]; // * Any additional objects. Data written by a Java class using "annotateClass"
	superClass?: JavaClassDesc | null; // * Class description for the object's super-class. Not set if class does not have a super-class

	clone(): JavaClassDescInfo // * Clones the object into a new instance
}
```

### `JavaClassDescInfoField`

Contains metadata about a specific field. If the field is an array or an object, an additional class name is present.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaClassDescInfoField {
	typeCode: string; // * Field type. Single character type code
	name: string; // * Field name
	className1?: JavaString | JavaLongString; // * Field type as a field descriptor. Only present if field type is either "[" (array) or "L" (object)

	clone(): JavaClassDescInfoField // * Clones the object into a new instance
}
```

### `JavaString`

Contains a string that uses a 16-bit length field.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaString {
	value: string; // * Underlying string value
	handle: number; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html#a8299

	clone(): JavaString // * Clones the object into a new instance
}
```

### `JavaLongString`

Contains a string that uses a 64-bit length field.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaLongString extends JavaString {
	clone(): JavaLongString // * Clones the object into a new instance
}
```

### `BlockData`

Contains raw data for a block which uses an 8-bit length field.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class BlockData {
	data: Buffer; // * Raw buffer of data. Up to the developer to interpret

	clone(): BlockData // * Clones the object into a new instance
}
```

### `BlockDataLong`

Contains raw data for a block which uses an 32-bit length field.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class BlockDataLong extends BlockData {
	clone(): BlockDataLong // * Clones the object into a new instance
}
```

### `JavaArray`

Contains an array of sub elements.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaArray {
	description?: JavaClassDesc | null; // * Description of the array structure
	handle: number; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html#a8299
	values: any[]; // * Array values

	clone(): JavaArray // * Clones the object into a new instance
}
```

### `JavaEnum`

Contains a single enum constant value.

> [!WARNING]
> Not intended for external use. Only intended for use internally, and for types externally.

```ts
class JavaEnum {
	description?: JavaClassDesc | null; // * Description of the enum structure
	handle: number; // * https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html#a8299
	constant: JavaString | JavaLongString; // * Name of a single value of the enum

	clone(): JavaEnum // * Clones the object into a new instance
}