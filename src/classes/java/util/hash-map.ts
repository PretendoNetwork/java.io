import { registerClass } from '@/java-object-input-stream';
import type JavaObjectInputStream from '@/java-object-input-stream';
import type { JavaClassDescription } from '@/types/java';

export default class HashMap {
	readObject(ois: JavaObjectInputStream, classDescription: JavaClassDescription) {
		ois.defaultReadObject(classDescription);

		const blockDataSize = ois.readBlockHeader();

		if (blockDataSize !== 8n) {
			throw new Error(`Unsupported HashMap block data size ${blockDataSize}`);
		}

		classDescription.data.buckets = ois.readInt();
		classDescription.data.size = ois.readInt();
		classDescription.data.map = {};

		for (let i = 0; i < classDescription.data.size; i++) {
			classDescription.data.map[ois.readObject()] = ois.readObject();
		}
	}
}

registerClass('java.util.HashMap', HashMap);