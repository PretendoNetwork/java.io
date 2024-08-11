// * TypeScript implementation of the https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/io/ObjectInputStream.html
// * Which is part of the https://docs.oracle.com/en/java/javase/11/docs/specs/serialization API used for reading Java serialized
// * objects. See https://docs.oracle.com/javase/6/docs/platform/serialization/spec/protocol.html for details on the protocol
// *
// * Based on both https://github.com/NickstaDB/SerializationDumper and https://github.com/node-modules/java.io

import type InputStream from '@/types/input-stream';
import type {
	JavaClassDescriptionInfo,
	JavaClassDescription,
	JavaObject
} from '@/types/java';

// TODO - Get rid of all of this? https://github.com/NickstaDB/SerializationDumper can dump ALL class data without needing these custom classes?
type Constructor<T = any> = new (...args: any[]) => T;

const CLASSES: {
	[key: string]: Constructor;
} = {};

export function registerClass(name: string, constructor: Constructor) {
	CLASSES[name] = constructor;
}

export default class JavaObjectInputStream {
	public stream: InputStream; // TODO - Make this private. Kept as public for debugging purposes outside of this class

	private readonly STREAM_MAGIC = Buffer.from([ 0xAC, 0xED ]);
	private readonly STREAM_VERSION = 5;
	private readonly TC_NULL = 0x70;
	private readonly TC_REFERENCE = 0x71;
	private readonly TC_CLASSDESC = 0x72;
	private readonly TC_OBJECT = 0x73;
	private readonly TC_STRING = 0x74;
	private readonly TC_ARRAY = 0x75;
	private readonly TC_CLASS = 0x76;
	private readonly TC_BLOCKDATA = 0x77;
	private readonly TC_ENDBLOCKDATA = 0x78;
	private readonly TC_RESET = 0x79;
	private readonly TC_BLOCKDATALONG = 0x7A;
	private readonly TC_EXCEPTION = 0x7B;
	private readonly TC_LONGSTRING = 0x7C;
	private readonly TC_PROXYCLASSDESC = 0x7D;
	private readonly TC_ENUM = 0x7E;

	private baseWireHandle = 0x7E0000;

	private readonly SC_WRITE_METHOD = 0X01;
	private readonly SC_SERIALIZABLE = 0X02;
	private readonly SC_EXTERNALIZABLE = 0X04;
	private readonly SC_BLOCK_DATA = 0X08;
	private readonly SC_ENUM = 0X10;

	private references: any[] = [];

	constructor(stream: InputStream) {
		this.stream = stream;

		const magic = this.stream.read(2);

		if (!this.STREAM_MAGIC.equals(magic)) {
			throw new Error('Bad magic');
		}

		const version = this.stream.readUInt16BE();

		if (version !== this.STREAM_VERSION) {
			throw new Error('Bad version');
		}
	}

	public checkNext() {
		// * Temporary debugging function. Used to manually check the position the
		// * decoder is at inside the data stream and what the current byte is. Used
		// * to check the next object type mostly
		// TODO - Remove this once complete
		console.log(this.stream.pos());
		console.log(this.stream.peek());
	}

	public 	readBoolean(): boolean {
		return this.stream.readBoolean();
	}

	public readByte(): number {
		return this.stream.readInt8();
	}

	public readChar(): string {
		const charCode = this.stream.readUInt16BE();
		return String.fromCharCode(charCode);
	}

	public readDouble(): number {
		return this.stream.readDoubleBE();
	}

	public readFloat(): number {
		return this.stream.readFloatBE();
	}

	public readInt(): number {
		return this.stream.readInt32BE();
	}

	public readLong(): bigint {
		return this.stream.readInt64BE();
	}

	public readObject(): any {
		const typeID = this.stream.peek();

		switch (typeID) {
			case this.TC_NULL:
				return this.readNull();
			case this.TC_REFERENCE:
				return this.readTC_REFERENCE();
			case this.TC_OBJECT:
				return this.readNewObject();
			case this.TC_ARRAY:
				return this.readTC_ARRAY();
			case this.TC_STRING:
			case this.TC_LONGSTRING:
				return this.readNewString();
			default:
				throw new Error(`Bad readObject type ID ${typeID}`);
		}
	}

	public readShort(): number {
		return this.stream.readInt16BE();
	}

	public readUnsignedByte(): number {
		return this.stream.readUInt8();
	}

	public readUnsignedShort(): number {
		return this.stream.readUInt16BE();
	}

	public readUTF(): string {
		const length = this.stream.readUInt16BE();
		return this.stream.read(length).toString();
	}

	public defaultReadObject(classDescription: JavaClassDescription) {
		this.defaultReadFields(classDescription);
	}

	public readBlockHeader(): bigint {
		const blockType = this.readByte();

		if (blockType === this.TC_BLOCKDATA) {
			return BigInt(this.readByte());
		} else if (blockType === this.TC_BLOCKDATALONG) {
			return this.readLong();
		}

		throw new Error(`Unsupported block data type ${blockType}`);
	}

	private defaultReadFields(classDescription: JavaClassDescription) {
		for (const field of classDescription.info.fields) {
			classDescription.data[field.name] = this.readFieldValue(field.type);
		}
	}

	private readFieldValue(type: string) {
		switch (type) {
			case 'B':
				return this.readByte();
			case 'C':
				return this.readChar();
			case 'D':
				return this.readDouble();
			case 'F':
				return this.readFloat();
			case 'I':
				return this.readInt();
			case 'J':
				return this.readLong();
			case 'S':
				return this.readShort();
			case 'Z':
				return this.readBoolean();
			case '[': // * Array
			case 'L': // * Object
				return this.readObject(); // * Handles both the above cases, despite the name
			default:
				throw new Error(`Unsupported field type ${type}`);
		}
	}

	private readClassData(classDescription: JavaClassDescription | null) {
		let classHierarchy: JavaClassDescription[] = [];

		while (classDescription) {
			classHierarchy.push(classDescription);
			classDescription = classDescription.info?.superClass || null;
		}

		classHierarchy = classHierarchy.reverse();

		for (const classDescription of classHierarchy) {
			const flags = classDescription.info.flags.flags;
			const name = classDescription.name;
			let checkEndBlock = (flags & this.SC_BLOCK_DATA) === this.SC_BLOCK_DATA;

			if (flags & this.SC_SERIALIZABLE) { // * Class extended `java.io.Serializable` but not `java.io.Externalizable`
				if (!CLASSES[name]) {
					throw new Error(`No class definition for ${name}`);
				}

				const cls = CLASSES[name];
				const inst = new cls();

				if (flags & this.SC_WRITE_METHOD) { // * Class had a `writeObject` method, so may be extra data
					inst.readObject(this, classDescription);
					checkEndBlock = true;
				} else { // * Class had no `writeObject` method, so no extra data
					if (inst.readObject) {
						inst.readObject(this, classDescription);
					} else {
						this.defaultReadObject(classDescription);
					}
				}
			} else if (flags & this.SC_EXTERNALIZABLE) { // * Class extended `java.io.Externalizable`
				this.checkNext();
				process.exit();
			} else {
				throw new Error(`Bad flags for ${name}, ${flags}`);
			}

			if (checkEndBlock) {
				const byte = this.readByte();
				if (byte !== this.TC_ENDBLOCKDATA) {
					throw new Error(`Invalid end block byte ${byte}`);
				}
			}
		}
	}

	private readNull() {
		this.stream.skip(1);
		return null;
	}

	private readNewObject(): JavaObject {
		const typeID = this.readByte();

		if (typeID !== this.TC_OBJECT) {
			throw new Error(`Bad TC_OBJECT type ID ${typeID}`);
		}

		const object = {
			class: this.readClassDesc()
		};

		this.references.push(object);
		this.readClassData(object.class);

		return object;
	}

	private readClassDesc(): JavaClassDescription | null {
		const typeID = this.stream.peek();

		switch (typeID) {
			case this.TC_NULL:
				return this.readNull();
			case this.TC_REFERENCE:
				return this.readTC_REFERENCE();
			case this.TC_CLASSDESC:
				return this.readNewClassDesc();
			default:
				throw new Error(`Bad readClassDesc typeID ${typeID}`);
		}
	}

	private readNewClassDesc(): JavaClassDescription {
		const typeID = this.stream.peek();

		switch (typeID) {
			case this.TC_CLASSDESC:
				return this.readTC_CLASSDESC();
			default:
				throw new Error(`Bad readNewClassDesc typeID ${typeID}`);
		}
	}

	private readClassDescInfo(): JavaClassDescriptionInfo {
		const classDescInfo: Record<string, any> = {
			flags: this.readClassDescFlags(),
			fields: this.readFields()
		};

		this.readClassAnnotation();

		classDescInfo.superClass = this.readSuperClassDesc();

		return classDescInfo as JavaClassDescriptionInfo;
	}

	private readClassDescFlags() {
		const flagsByte = this.readByte();
		const flags: string[] = [];

		if ((flagsByte & this.SC_WRITE_METHOD) === this.SC_WRITE_METHOD) {
			flags.push('SC_WRITE_METHOD');
		}

		if ((flagsByte & this.SC_SERIALIZABLE) === this.SC_SERIALIZABLE) {
			flags.push('SC_SERIALIZABLE');
		}

		if ((flagsByte & this.SC_EXTERNALIZABLE) === this.SC_EXTERNALIZABLE) {
			flags.push('SC_EXTERNALIZABLE');
		}

		if ((flagsByte & this.SC_BLOCK_DATA) === this.SC_BLOCK_DATA) {
			flags.push('SC_BLOCK_DATA');
		}

		if ((flagsByte & this.SC_ENUM) === this.SC_ENUM) {
			flags.push('SC_ENUM');
		}

		return {
			flags: flagsByte,
			strings: flags
		};
	}

	private readFields() {
		const fieldsCount = this.readShort();
		const fields: any[] = [];

		for (let i = 0; i < fieldsCount; i++) {
			fields.push(this.readFieldDesc());
		}

		return fields;
	}

	private readFieldDesc() {
		const fieldDescription: Record<string, any> = {
			type: String.fromCharCode(this.readByte()),
			name: this.readUTF()
		};

		if (fieldDescription.type === '[' || fieldDescription.type === 'L') {
			fieldDescription.class = this.readObject();
		}

		return fieldDescription;
	}

	private readClassAnnotation() {
		const typeID = this.readByte();

		if (typeID !== this.TC_ENDBLOCKDATA) {
			throw new Error(`Unsupported class annotation type ${typeID}`);
		}
	}

	private readSuperClassDesc() {
		return this.readClassDesc();
	}

	private readNewString() {
		const typeID = this.stream.peek();
		let string: string | undefined;

		switch (typeID) {
			case this.TC_STRING:
				string = this.readTC_STRING();
		}

		if (string === undefined) {
			throw new Error(`Bad readNewString type ID ${typeID}`);
		}

		this.references.push(string);

		return string;
	}

	private readTC_REFERENCE() {
		const typeID = this.readByte();

		if (typeID !== this.TC_REFERENCE) {
			throw new Error(`Bad TC_REFERENCE type ID ${typeID}`);
		}

		const handle = this.readInt();

		return this.references[handle - this.baseWireHandle];
	}

	private readTC_CLASSDESC(): JavaClassDescription {
		const typeID = this.readByte();

		if (typeID !== this.TC_CLASSDESC) {
			throw new Error(`Bad TC_CLASSDESC type ID ${typeID}`);
		}

		const classDescription: Record<string, any> = {
			name: this.readUTF(),
			serialVersionUID: this.readLong().toString(),
			data: {}
		};

		this.references.push(classDescription);

		classDescription.info = this.readClassDescInfo();

		return classDescription as JavaClassDescription;
	}

	private readTC_ARRAY(): JavaObject {
		const typeID = this.readByte();

		if (typeID !== this.TC_ARRAY) {
			throw new Error(`Bad TC_ARRAY type ID ${typeID}`);
		}

		const object = {
			class: this.readClassDesc()
		};

		object.class!.data = [];

		this.references.push(object);

		// * Inline reading the elements
		const size = this.readInt();
		const type = object.class?.name[1]; // * Names are like [B, [I, etc. Index 1 is the type, B, I, etc.

		for (var i = 0; i < size; i++) {
			object.class!.data.push(this.readFieldValue(type!));
		}

		if (object.class?.name === '[B') {
			object.class.data = Buffer.from(object.class.data);
		}

		return object;
	}

	private readTC_STRING(): string {
		const typeID = this.readByte();

		if (typeID !== this.TC_STRING) {
			throw new Error(`Bad TC_STRING type ID ${typeID}`);
		}

		return this.readUTF();
	}
}