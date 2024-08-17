// * TypeScript implementation of the https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/io/ObjectInputStream.html
// * Which is part of the https://docs.oracle.com/en/java/javase/11/docs/specs/serialization API used for reading Java serialized
// * objects. See https://docs.oracle.com/javase/6/docs/platform/serialization/spec/protocol.html for details on the protocol
// *
// * Based on both https://github.com/NickstaDB/SerializationDumper and https://github.com/node-modules/java.io

import type InputStream from '@/types/input-stream';

export default class ObjectInputStream {
	private stream: InputStream;

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

	private readonly baseWireHandle = 0x7E0000; // * Used for reference lookups
	private currentHandle = 0x7E0000; // * Used for reference assignments

	private readonly SC_WRITE_METHOD = 0X01;
	private readonly SC_SERIALIZABLE = 0X02;
	private readonly SC_EXTERNALIZABLE = 0X04;
	private readonly SC_BLOCKDATA = 0X08;
	private readonly SC_ENUM = 0X10;

	// TODO - Remove this "any"
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

	// * Begin helper methods. Used to emulate https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/io/ObjectInputStream.html
	// * and to assist in internal data reading. Can be defined in whatever order makes sense

	public readBoolean(): boolean {
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

	public readLongUTF(): string {
		const length = this.stream.readInt64BE();
		return this.stream.read(Number(length)).toString();
	}

	public readAll(): JavaObject[] {
		const objects: JavaObject[] = [];

		while (this.stream.hasDataLeft()) {
			objects.push(this.readContentElement());
		}

		return objects;
	}

	private readContentElement(): any { // TODO - Remove this "any"
		// * contents:
		// *   content
		// *   contents content
		// * content:
		// *   object
		// *   blockdata
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_OBJECT:
				return this.readNewObject();
			case this.TC_STRING:
				return this.readNewString();
			case this.TC_BLOCKDATA:
				return this.readTC_BLOCKDATA();
			case this.TC_BLOCKDATALONG:
				return this.readTC_BLOCKDATALONG();
			case this.TC_LONGSTRING:
				return this.readNewString();
			case this.TC_REFERENCE:
				return this.readPrevObject();

			default:
				throw new Error(`Unsupported type code ${typeCode}`);
		}
	}

	private readValues(classDesc: JavaClassDesc): void {
		for (const field of classDesc.info.fields) {
			classDesc.classData.values[field.name] = this.readFieldValue(field.typeCode);
		}
	}

	private readFieldValue(typeCode: string): any { // TODO - Remove this "any"
		switch (typeCode) {
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
				return this.readArrayFieldValue();
			case 'L': // * Object
				return this.readObjectFieldValue();
			default:
				throw new Error(`Unsupported field type ${typeCode}`);
		}
	}

	private readArrayFieldValue(): any { // TODO - Remove this "any"
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_NULL:
				return this.readNullReference();
			case this.TC_ARRAY:
				return this.readNewArray();
			case this.TC_REFERENCE:
				return this.readPrevObject();

			default:
				throw new Error(`Unsupported readArrayFieldValue type code ${typeCode}`);
		}
	}

	private readObjectFieldValue(): any { // TODO - Remove this "any"
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_NULL:
				return this.readNullReference();
			case this.TC_OBJECT:
				return this.readNewObject();
			case this.TC_STRING:
				return this.readTC_STRING();
			case this.TC_REFERENCE:
				return this.readPrevObject();
			case this.TC_ENUM:
				return this.readNewEnum();

			default:
				throw new Error(`Unsupported readObjectFieldValue type code ${typeCode}`);
		}
	}

	// * Begin type readers. Should be defined in order as they appear in
	// * https://docs.oracle.com/javase/6/docs/platform/serialization/spec/protocol.html

	private readClassDesc(): any { // TODO - Remove this "any"
		// * classDesc:
		// *   newClassDesc
		// *   nullReference
		// *   (ClassDesc)prevObject      // an object required to be of type
		// *                              // ClassDesc
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_NULL:
				return this.readNullReference();
			case this.TC_CLASSDESC:
			case this.TC_PROXYCLASSDESC:
				return this.readNewClassDesc();
			case this.TC_REFERENCE:
				return this.readPrevObject();
			default:
				throw new Error(`Unsupported classDesc type code ${typeCode}`);
		}
	}

	private readNewClassDesc(): any { // TODO - Remove this "any"
		// * newClassDesc:
		// *   TC_CLASSDESC className serialVersionUID newHandle classDescInfo
		// *   TC_PROXYCLASSDESC newHandle proxyClassDescInfo
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_CLASSDESC:
				return this.readTC_CLASSDESC();

			default:
				throw new Error(`Unsupported newClassDesc type code ${typeCode}`);
		}
	}

	private readClassDescInfo(): JavaClassDescInfo {
		// * classDescInfo:
		// *   classDescFlags fields classAnnotation superClassDesc
		const classDescInfo = new JavaClassDescInfo();

		classDescInfo.flags = this.readByte();
		classDescInfo.fields = this.readFields();
		classDescInfo.annotation = this.readClassAnnotation();
		classDescInfo.superClass = this.readClassDesc();

		return classDescInfo;
	}

	private readFields(): JavaClassDescInfoField[] {
		// * fields:
		// *   (short)<count>  fieldDesc[count]
		const fields: JavaClassDescInfoField[] = [];
		const count = this.readShort();

		for (let i = 0; i < count; i++) {
			fields.push(this.readFieldDesc());
		}

		return fields;
	}

	private readFieldDesc(): JavaClassDescInfoField {
		// * fieldDesc:
		// *   primitiveDesc
		// *   objectDesc
		const field = new JavaClassDescInfoField();

		field.typeCode = String.fromCharCode(this.readByte());
		field.name = this.readUTF();

		if (field.typeCode === '[' || field.typeCode === 'L') {
			// * objectDesc
			field.className1 = this.readNewString();
		}

		return field;
	}

	private readClassAnnotation(): any[] { // TODO - Remove this "any"
		// * classAnnotation:
		// *   endBlockData
		// *   contents endBlockData      // contents written by annotateClass
		let annotations: any[] = []; // TODO - Remove this "any"

		while (this.stream.peek() !== this.TC_ENDBLOCKDATA) {
			annotations.push(this.readContentElement());
		}

		this.stream.skip(1); // * Skip the TC_ENDBLOCKDATA byte

		return annotations;
	}

	private readNewArray(): JavaArray {
		// * newArray:
		// *   TC_ARRAY classDesc newHandle (int)<size> values[size]
		const typeCode = this.readByte();

		if (typeCode !== this.TC_ARRAY) {
			throw new Error(`Invalid TC_ARRAY type code ${typeCode}`);
		}

		const array = new JavaArray();

		array.description = this.readClassDesc();
		this.newHandle(array);

		const size = this.readInt();

		if (array.description) {
			for (let i = 0; i < size; i++) {
				array.values.push(this.readFieldValue(array.description.className.value[1]))
			}
		}

		return array;
	}

	private readNewObject(): JavaObject {
		// * newObject:
		// *   TC_OBJECT classDesc newHandle classdata[]  // data for each class
		const typeCode = this.readByte();

		if (typeCode !== this.TC_OBJECT) {
			throw new Error(`Invalid TC_OBJECT type code ${typeCode}`);
		}

		const object = new JavaObject();

		object.description = this.readClassDesc();
		this.newHandle(object);

		if (object.description) {
			this.readClassData(object.description);
		}

		return object;
	}

	private readClassData(classDesc: JavaClassDesc | null): void {
		// * classdata:
		// *   nowrclass                 // SC_SERIALIZABLE & classDescFlag &&
		// *                             // !(SC_WRITE_METHOD & classDescFlags)
		// *   wrclass objectAnnotation  // SC_SERIALIZABLE & classDescFlag &&
		// *                             // SC_WRITE_METHOD & classDescFlags
		// *   externalContents          // SC_EXTERNALIZABLE & classDescFlag &&
		// *                             // !(SC_BLOCKDATA  & classDescFlags
		// *   objectAnnotation          // SC_EXTERNALIZABLE & classDescFlag&&
		// *                             // SC_BLOCKDATA & classDescFlags
		// * nowrclass:
		// *   values                    // fields in order of class descriptor
		// * wrclass:
		// *   nowrclass
		let classHierarchy: JavaClassDesc[] = [];

		while (classDesc) {
			classHierarchy.push(classDesc);
			classDesc = classDesc.info?.superClass || null;
		}

		classHierarchy = classHierarchy.reverse();

		for (const classDescription of classHierarchy) {
			let hasObjectAnnotation = false;
			if (classDescription.hasFlag(this.SC_SERIALIZABLE)) {
				this.readValues(classDescription);

				if (classDescription.hasFlag(this.SC_WRITE_METHOD)) {
					hasObjectAnnotation = true;
				}
			}

			if (classDescription.hasFlag(this.SC_EXTERNALIZABLE)) {
				if (classDescription.hasFlag(this.SC_BLOCKDATA)) {
					hasObjectAnnotation = true;
				} else {
					throw new Error('Cannot parse externalContents. Only protocol version 2 supported')
				}
			}

			if (hasObjectAnnotation) {
				// * Data encoded with writeObject (version 1) or writeExternal (version 2).
				// * Is encoded the same way as class annotations
				classDescription.classData.annotation = this.readClassAnnotation();
			}
		}
	}

	private readNewString(): any { // TODO - Remove this "any"
		// * newString:
		// *   TC_STRING newHandle (utf)
		// *   TC_LONGSTRING newHandle (long-utf)
		const typeCode = this.stream.peek();

		switch (typeCode) {
			case this.TC_STRING:
				return this.readTC_STRING();
			case this.TC_LONGSTRING:
				return this.readTC_LONGSTRING();
			case this.TC_REFERENCE:
				return this.readPrevObject();

			default:
				throw new Error(`Unsupported newString type code ${typeCode}`);
		}
	}

	private readNewEnum(): JavaEnum {
		// * newEnum:
		// *   TC_ENUM classDesc newHandle enumConstantName
		const typeCode = this.readByte();

		if (typeCode !== this.TC_ENUM) {
			throw new Error(`Invalid TC_ENUM type code ${typeCode}`);
		}

		const jenum = new JavaEnum(); // * TypeScript throws a fit if you use "enum" as a variable name...

		jenum.description = this.readClassDesc();
		this.newHandle(jenum);

		jenum.constant = this.readNewString();

		return jenum;
	}

	private readPrevObject(): any { // TODO - Remove this "any"
		// * prevObject
		// *   TC_REFERENCE (int)handle
		const typeCode = this.readByte();

		if (typeCode !== this.TC_REFERENCE) {
			throw new Error(`Invalid TC_REFERENCE type code ${typeCode}`);
		}

		// * Return a clone because new data is written to the class instance.
		// * In JavaScript this will update ALL references to the instance.
		const handle = this.readInt();
		const object = this.references[handle - this.baseWireHandle];
		const clone = object.clone();

		return clone;
	}

	private readNullReference(): null {
		// * nullReference
		// *   TC_NULL
		this.stream.skip(1);

		return null;
	}

	private newHandle(object: { handle: number }): void {
		// * newHandle:       // The next number in sequence is assigned
		// *                  // to the object being serialized or deserialized
		object.handle = ++this.currentHandle;

		this.references.push(object);
	}

	// * Begin type code (TC) readers. Should be defined in numerical order by type code

	private readTC_CLASSDESC(): JavaClassDesc {
		// * TC_CLASSDESC className serialVersionUID newHandle classDescInfo
		const typeCode = this.readByte();

		if (typeCode !== this.TC_CLASSDESC) {
			throw new Error(`Invalid TC_CLASSDESC type code ${typeCode}`);
		}

		const classDesc = new JavaClassDesc();

		classDesc.className.value = this.readUTF();
		classDesc.serialVersionUID = this.readLong();
		this.newHandle(classDesc);
		classDesc.info = this.readClassDescInfo();

		return classDesc;
	}

	private readTC_STRING(): JavaString {
		// * TC_STRING newHandle (utf)
		const typeCode = this.readByte();

		if (typeCode !== this.TC_STRING) {
			throw new Error(`Invalid TC_STRING type code ${typeCode}`);
		}

		const string = new JavaString();

		this.newHandle(string);
		string.value = this.readUTF();

		return string;
	}

	private readTC_BLOCKDATA(): BlockData {
		// * blockdatashort:
		// *   TC_BLOCKDATA (unsigned byte)<size> (byte)[size]
		const typeCode = this.readByte();

		if (typeCode !== this.TC_BLOCKDATA) {
			throw new Error(`Invalid TC_BLOCKDATA type code ${typeCode}`);
		}

		const blockData = new BlockData();
		const size = this.readByte();

		blockData.data = this.stream.read(size);

		return blockData;
	}

	private readTC_BLOCKDATALONG(): BlockDataLong {
		// * blockdatalong:
		// *   TC_BLOCKDATALONG (int)<size> (byte)[size]
		const typeCode = this.readByte();

		if (typeCode !== this.TC_BLOCKDATALONG) {
			throw new Error(`Invalid TC_BLOCKDATALONG type code ${typeCode}`);
		}

		const blockData = new BlockDataLong();
		const size = this.readInt();

		blockData.data = this.stream.read(size);

		return blockData;
	}

	private readTC_LONGSTRING(): JavaLongString {
		// * TC_LONGSTRING newHandle (long-utf)
		const typeCode = this.readByte();

		if (typeCode !== this.TC_LONGSTRING) {
			throw new Error(`Invalid TC_LONGSTRING type code ${typeCode}`);
		}

		const string = new JavaLongString();

		this.newHandle(string);
		string.value = this.readLongUTF();

		return string;
	}
}

class ClassData {
	public values: Record<string, any> = {}; // TODO - Remove this "any"
	public annotation: any[] = []; // TODO - Remove this "any"

	public clone() {
		const clone = new ClassData();

		for (const key in this.values) {
			const value = this.values[key];

			if (hasMethod(value, 'clone')) {
				clone.values[key] = value.clone();
			} else {
				clone.values[key] = value;
			}
		}

		for (const value of this.annotation) {
			if (hasMethod(value, 'clone')) {
				clone.annotation.push(value.clone());
			} else {
				clone.annotation.push(value);
			}
		}

		return clone;
	}
}

class JavaObject {
	public description?: JavaClassDesc | null;
	public handle!: number;

	public clone() {
		const clone = new JavaObject();

		clone.description = this.description?.clone();

		return clone;
	}
}

class JavaClassDesc {
	public className = new JavaString();
	public serialVersionUID!: bigint;
	public handle!: number;
	public info!: JavaClassDescInfo;
	public classData = new ClassData();

	public hasFlag(flag: number): boolean {
		return (this.info.flags & flag) === flag;
	}

	public clone() {
		const clone = new JavaClassDesc();

		clone.className = this.className.clone();
		clone.info = this.info.clone();
		clone.classData = this.classData.clone();

		return clone;
	}
}

class JavaClassDescInfo {
	public flags!: number;
	public fields: JavaClassDescInfoField[] = [];
	public annotation: any[] = []; // TODO - Remove this "any"
	public superClass?: JavaClassDesc | null;

	public clone() {
		const clone = new JavaClassDescInfo();

		clone.flags = Number(this.flags);

		for (const value of this.fields) {
			clone.fields.push(value.clone());
		}

		for (const value of this.annotation) {
			if (hasMethod(value, 'clone')) {
				clone.annotation.push(value.clone());
			} else {
				clone.annotation.push(value);
			}
		}

		clone.superClass = this.superClass?.clone();

		return clone;
	}
}

class JavaClassDescInfoField {
	public typeCode!: string;
	public name!: string;
	public className1?: JavaString | JavaLongString;

	public clone() {
		const clone = new JavaClassDescInfoField();

		clone.typeCode = String(this.typeCode);
		clone.name = String(this.name);
		clone.className1 = this.className1?.clone();

		return clone;
	}
}

class JavaString {
	public value!: string;
	public handle!: number;

	public clone() {
		const clone = new JavaString();

		clone.value = String(this.value);

		return clone;
	}
}

class JavaLongString extends JavaString {
	public clone() {
		const clone = new JavaLongString();

		clone.value = String(this.value);

		return clone;
	}
}

class BlockData {
	public data!: Buffer;

	public clone() {
		const clone = new BlockData();

		clone.data = Buffer.from(this.data);

		return clone;
	}
}

class BlockDataLong extends BlockData {
	public clone() {
		const clone = new BlockDataLong();

		clone.data = Buffer.from(this.data);

		return clone;
	}
}

class JavaArray {
	public description?: JavaClassDesc | null;
	public handle!: number;
	public values: any[] = []; // TODO - Remove this "any"

	public clone() {
		const clone = new JavaArray();

		clone.description = this.description?.clone();

		for (const value of this.values) {
			if (hasMethod(value, 'clone')) {
				clone.values.push(value.clone());
			} else {
				clone.values.push(value);
			}
		}

		return clone;
	}
}

class JavaEnum {
	public description?: JavaClassDesc | null;
	public handle!: number;
	public constant!: JavaString | JavaLongString;

	public clone() {
		const clone = new JavaEnum();

		clone.description = this.description?.clone();
		clone.constant = this.constant.clone();

		return clone;
	}
}

function hasMethod(value: any, methodName: string): boolean {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);

	if (prototype === null || prototype === Object.prototype) {
		return false;
	}

	return typeof value[methodName] === 'function';
}