export default interface InputStream {
	pos(): number;
	peek(): number;
	skip(offset: number): void;
	read(len: number): Buffer;
	readBoolean(): boolean;
	readInt8(): number;
	readInt16BE(): number;
	readInt32BE(): number;
	readInt64BE(): bigint;
	readUInt8(): number;
	readUInt16BE(): number;
	readDoubleBE(): number;
	readFloatBE(): number;
};